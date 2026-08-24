import { and, asc, eq, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { config } from '../config.js'
import { acquireLeaderLease, LEADER_KEYS, type LeaderLease } from '../lib/leader-lock.js'
import { logger } from '../logger.js'
import { candidateEvidence, radarCandidates, radarJobEvents, radarQueueItems, radarTasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { hasAiConfiguration } from '../ai/client.js'
import { enrichCandidateWithAi } from './ai-enrichment.js'
import { enrichCandidateContacts } from './contact-enrichment.js'
import { WebsiteSeedConnector } from './connectors/website-seed.js'
import { SearchDiscoveryConnector } from './connectors/search-discovery.js'
import { MapDiscoveryConnector } from './connectors/map-discovery.js'
import { IndustrySourceConnector } from './connectors/industry-source.js'
import { ConnectorError, type DiscoveredCandidate, type DiscoveryConnector, type RadarTaskContext } from './types.js'
import { isExportOverseasProspect, isLikelyOverseasProspect } from './connectors/prospect-quality.js'

const connectors: DiscoveryConnector[] = [new MapDiscoveryConnector(), new SearchDiscoveryConnector(), new IndustrySourceConnector(), new WebsiteSeedConnector()]

const parseJson = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T } catch { return fallback }
}

const addEvent = async (workspaceId: string, radarTaskId: string, queueItemId: string, eventType: string, message: string, level = 'info', metadata: unknown = {}) => {
  await db.insert(radarJobEvents).values({ id: createId('evt'), workspaceId, radarTaskId, queueItemId, eventType, message, level, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

const taskCounts = async (workspaceId: string, radarTaskId: string) => (await db.$first(db.select({
  total: sql<number>`count(*)`,
  highMatch: sql<number>`sum(case when ${radarCandidates.score} >= 90 then 1 else 0 end)`,
}).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, workspaceId), eq(radarCandidates.radarTaskId, radarTaskId)))))

const saveCandidate = async (workspaceId: string, radarTaskId: string, candidate: DiscoveredCandidate) => {
  const existing = (await db.$first(db.select().from(radarCandidates).where(and(eq(radarCandidates.workspaceId, workspaceId), eq(radarCandidates.company, candidate.company)))))
  if (existing) {
    const currentEvidence = (await db.select({ sourceUrl: candidateEvidence.sourceUrl }).from(candidateEvidence).where(and(eq(candidateEvidence.workspaceId, workspaceId), eq(candidateEvidence.candidateId, existing.id))))
    const knownUrls = new Set(currentEvidence.map(item => item.sourceUrl))
    const newEvidence = candidate.evidence.filter(item => !knownUrls.has(item.sourceUrl))
    const currentRelationships = parseJson<{ label: string; value: string }[]>(existing.relationshipsJson, [])
    const relationshipKeys = new Set(currentRelationships.map(item => `${item.label}\u0000${item.value}`))
    const mergedRelationships = [...currentRelationships, ...candidate.relationships.filter(item => !relationshipKeys.has(`${item.label}\u0000${item.value}`))]
    const sources = [...new Set([existing.source, candidate.source].flatMap(item => item.split(' · ')).filter(Boolean))].join(' · ')
    const now = Date.now()
    await db.transaction(async tx => {
            await tx.update(radarCandidates).set({
                      region: existing.region === '待补全' ? candidate.region : existing.region,
                      industry: existing.industry === '待补全' ? candidate.industry : existing.industry,
                      score: Math.max(existing.score, candidate.score),
                      confidence: Math.max(existing.confidence, candidate.confidence),
                      source: sources,
                      relationshipsJson: JSON.stringify(mergedRelationships),
                      updatedAt: now,
                    }).where(and(eq(radarCandidates.id, existing.id), eq(radarCandidates.workspaceId, workspaceId)))
            if (newEvidence.length) await tx.insert(candidateEvidence).values(newEvidence.map(evidence => ({
                    id: createId('evd'), workspaceId, candidateId: existing.id, title: evidence.title, source: evidence.source,
                    observedLabel: evidence.time, strength: evidence.strength, sourceUrl: evidence.sourceUrl, createdAt: now,
                  })))
          })
    return { created: false, id: existing.id }
  }
  const now = Date.now()
  const candidateId = createId('can')
  await db.transaction(async tx => {
        await tx.insert(radarCandidates).values({
                id: candidateId, workspaceId, radarTaskId, company: candidate.company, region: candidate.region,
                industry: candidate.industry, size: candidate.size, score: candidate.score, signal: candidate.signal,
                source: candidate.source, estimatedValue: candidate.estimatedValue, currency: candidate.currency,
                confidence: candidate.confidence, status: 'candidate', reason: candidate.reason,
                dimensionsJson: JSON.stringify(candidate.dimensions), committeeJson: JSON.stringify(candidate.committee),
                relationshipsJson: JSON.stringify(candidate.relationships), discoveredAt: now, updatedAt: now,
              })
        if (candidate.evidence.length) await tx.insert(candidateEvidence).values(candidate.evidence.map(evidence => ({
              id: createId('evd'), workspaceId, candidateId, title: evidence.title, source: evidence.source,
              observedLabel: evidence.time, strength: evidence.strength, sourceUrl: evidence.sourceUrl, createdAt: now,
            })))
      })
  return { created: true, id: candidateId }
}

export const createRadarWorker = (intervalMs: number) => {
  let timer: ReturnType<typeof setInterval> | undefined
  let processing = false

  const processNext = async () => {
    if (processing) return false
    processing = true
    let activeQueueId: string | undefined
    try {
      const now = Date.now()
      const queue = (await db.$first(db.select().from(radarQueueItems).where(and(eq(radarQueueItems.status, 'queued'), lte(radarQueueItems.scheduledAt, now))).orderBy(asc(radarQueueItems.scheduledAt), asc(radarQueueItems.createdAt))))
      if (!queue) return false
      const task = (await db.$first(db.select().from(radarTasks).where(and(eq(radarTasks.id, queue.radarTaskId), eq(radarTasks.workspaceId, queue.workspaceId)))))
      if (!task || task.status !== 'queued') {
        await db.update(radarQueueItems).set({ status: task?.status === 'cancelled' ? 'cancelled' : 'failed', lastError: task ? `任务状态为 ${task.status}` : '任务不存在', completedAt: now, updatedAt: now }).where(eq(radarQueueItems.id, queue.id))
        return true
      }
      const claimedAttempts = queue.attempts + 1
      const claim = (await db.update(radarQueueItems).set({ status: 'running', attempts: claimedAttempts, startedAt: now, lastError: null, updatedAt: now }).where(and(eq(radarQueueItems.id, queue.id), eq(radarQueueItems.status, 'queued'))))
      if (!(claim.rowsAffected ?? 0)) return false
      activeQueueId = queue.id
      await db.update(radarTasks).set({ status: 'running', progress: 5, currentStage: '正在连接数据源', lastError: null, startedAt: task.startedAt ?? now, completedAt: null, updatedAt: now }).where(eq(radarTasks.id, task.id))
      await addEvent(task.workspaceId, task.id, queue.id, 'task.started', `开始第 ${claimedAttempts} 次执行`)

      const context: RadarTaskContext = {
        id: task.id, workspaceId: task.workspaceId, name: task.name, icp: task.icp, mode: task.mode,
        depth: task.depth, candidateLimit: task.candidateLimit, targetRegion: task.targetRegion,
        researchLanguage: task.researchLanguage, seedUrls: parseJson(task.seedUrlsJson, []),
      }
      const supported = await Promise.all(connectors.map(connector => connector.supports(context)))
      const available = connectors.filter((_, index) => supported[index])
      if (!available.length) throw new ConnectorError('没有可执行的数据源。请先配置搜索或地图数据源，或为官网、行业名录、展会协会和招投标任务填写至少一个公开来源网址。')
      let discovered = 0
      const aiEnabled = (await hasAiConfiguration(task.workspaceId))
      if (!aiEnabled) await addEvent(task.workspaceId, task.id, queue.id, 'ai.skipped', '未配置可用 AI 服务，本次使用公开证据完成基础研究', 'info')
      for (const [connectorIndex, connector] of available.entries()) {
        const remaining = Math.max(0, task.candidateLimit - discovered)
        if (!remaining) break
        const remainingConnectors = available.length - connectorIndex
        const connectorLimit = context.mode === '智能多渠道' ? Math.max(1, Math.ceil(remaining / remainingConnectors)) : remaining
        const connectorContext = { ...context, candidateLimit: connectorLimit }
        await addEvent(task.workspaceId, task.id, queue.id, 'connector.started', `正在运行：${connector.label}`, 'info', { connectorId: connector.id })
        const discoveredResults = await connector.discover(connectorContext, async (message, progress) => {
          await db.update(radarTasks).set({ progress: Math.max(5, Math.min(progress, 90)), currentStage: message, updatedAt: Date.now() }).where(eq(radarTasks.id, task.id))
        })
        const results = discoveredResults.filter(isExportOverseasProspect)
        const excludedByExportRule = discoveredResults.length - results.length
        if (excludedByExportRule > 0) await addEvent(task.workspaceId, task.id, queue.id, 'prospect.filtered_export', `${connector.label}已过滤 ${excludedByExportRule} 条中国境内/中文公司结果`, 'info', { connectorId: connector.id, excluded: excludedByExportRule })
        for (const candidate of results.slice(0, Math.max(0, task.candidateLimit - discovered))) {
          let researched = candidate
          if (aiEnabled) {
            const enrichment = await enrichCandidateWithAi(connectorContext, candidate)
            researched = enrichment.candidate
            await addEvent(task.workspaceId, task.id, queue.id, 'ai.enriched', `${candidate.company} 已完成 AI 证据研究`, 'info', { serviceName: enrichment.serviceName, model: enrichment.model, latencyMs: enrichment.latencyMs })
          }
          if (!isExportOverseasProspect(researched)) {
            await addEvent(task.workspaceId, task.id, queue.id, 'prospect.filtered_export', `${researched.company} 经判定为中国境内公司，已排除`, 'info')
            continue
          }
          const relevanceInput = {
            company: researched.company,
            industry: researched.industry + ' ' + candidate.industry,
            signal: researched.signal + ' ' + candidate.signal,
            reason: researched.reason + ' ' + candidate.reason,
            source: researched.source + ' ' + candidate.source,
            icp: task.icp,
          }
          if (researched.score < 35) {
            await addEvent(task.workspaceId, task.id, queue.id, 'prospect.filtered_quality', `${researched.company} 匹配分过低，已排除`, 'info')
            continue
          }
          if (!isLikelyOverseasProspect(relevanceInput)) {
            await addEvent(task.workspaceId, task.id, queue.id, 'prospect.filtered_relevance', `${researched.company} 与目标客户画像不匹配，已排除`, 'info')
            continue
          }
          const result = (await saveCandidate(task.workspaceId, task.id, researched))
          if (result.created) discovered += 1
          if (result.created && /深度/.test(connectorContext.depth)) {
            try {
              const contactResult = await enrichCandidateContacts(task.workspaceId, result.id)
              await addEvent(task.workspaceId, task.id, queue.id, 'contacts.enriched', contactResult?.discovered ? `${candidate.company} 已发现 ${contactResult.discovered} 条公开联系方式` : `${candidate.company} 未发现可验证的公开联系方式`, 'info', { discovered: contactResult?.discovered ?? 0, pagesScanned: contactResult?.pagesScanned ?? 0 })
            } catch (cause) {
              await addEvent(task.workspaceId, task.id, queue.id, 'contacts.degraded', `${candidate.company} 的公开联系人补全未完成，候选研究结果已保留`, 'warning', { reason: cause instanceof Error ? cause.message : '联系人补全失败' })
            }
          }
        }
        await addEvent(task.workspaceId, task.id, queue.id, 'connector.completed', `${connector.label}完成，新增 ${discovered} 家候选`, 'info', { connectorId: connector.id, discovered })
      }
      const counts = (await taskCounts(task.workspaceId, task.id))
      const completedAt = Date.now()
      await db.transaction(async tx => {
                await tx.update(radarTasks).set({ status: 'completed', progress: 100, currentStage: '研究完成', candidatesFound: counts?.total ?? 0, highMatchCount: counts?.highMatch ?? 0, completedAt, updatedAt: completedAt }).where(eq(radarTasks.id, task.id))
                await tx.update(radarQueueItems).set({ status: 'completed', completedAt, updatedAt: completedAt }).where(eq(radarQueueItems.id, queue.id))
              })
      await addEvent(task.workspaceId, task.id, queue.id, 'task.completed', `任务完成，共保留 ${counts?.total ?? 0} 家候选`)
      return true
    } catch (cause) {
      const queue = activeQueueId ? (await db.$first(db.select().from(radarQueueItems).where(eq(radarQueueItems.id, activeQueueId)))) : undefined
      if (!queue) return false
      const message = cause instanceof Error ? cause.message : '雷达任务执行失败'
      const retryable = cause instanceof ConnectorError && cause.retryable
      const shouldRetry = retryable && queue.attempts < queue.maxAttempts
      const now = Date.now()
      const scheduledAt = shouldRetry ? now + Math.min(60_000, 5_000 * 2 ** Math.max(0, queue.attempts - 1)) : queue.scheduledAt
      await db.transaction(async tx => {
                await tx.update(radarQueueItems).set({ status: shouldRetry ? 'queued' : 'failed', lastError: message, scheduledAt, completedAt: shouldRetry ? null : now, updatedAt: now }).where(eq(radarQueueItems.id, queue.id))
                await tx.update(radarTasks).set({ status: shouldRetry ? 'queued' : 'failed', currentStage: shouldRetry ? `等待自动重试（${queue.attempts}/${queue.maxAttempts}）` : '执行失败', lastError: message, completedAt: shouldRetry ? null : now, updatedAt: now }).where(eq(radarTasks.id, queue.radarTaskId))
              })
      await addEvent(queue.workspaceId, queue.radarTaskId, queue.id, shouldRetry ? 'task.retry_scheduled' : 'task.failed', shouldRetry ? `${message}；已安排自动重试` : message, 'error', { attempts: queue.attempts, maxAttempts: queue.maxAttempts })
      return true
    } finally {
      processing = false
    }
  }

  let electionTimer: NodeJS.Timeout | undefined;
  let lease: LeaderLease | null = null;

  const scheduleElection = () => {
    if (electionTimer) return;
    electionTimer = setTimeout(() => {
      electionTimer = undefined;
      void elect();
    }, config.workerLeaderElectionIntervalMs);
    electionTimer.unref?.();
  };

  const activate = async () => {
    if (timer) return;
    const now = Date.now();
    await db.update(radarQueueItems).set({ status: 'queued', lastError: '服务重启后恢复执行', scheduledAt: now, updatedAt: now }).where(eq(radarQueueItems.status, 'running'));
    await db.update(radarTasks).set({ status: 'queued', currentStage: '服务重启后恢复队列', updatedAt: now }).where(eq(radarTasks.status, 'running'));
    void processNext();
    timer = setInterval(() => { void processNext() }, intervalMs);
    logger.info({ intervalMs }, 'Radar worker elected as leader');
  };

  const elect = async () => {
    if (timer || electionTimer) return;
    if (!config.workerLeaderLock) {
      await activate();
      return;
    }
    try {
      lease = await acquireLeaderLease(LEADER_KEYS.radar, () => {
        logger.warn('Radar worker leader lock lost; standing down');
        if (timer) clearInterval(timer);
        timer = undefined;
        void lease?.release();
        lease = null;
        scheduleElection();
      });
      if (lease) await activate();
      else {
        logger.info('Radar worker is standby; another instance owns the leader lock');
        scheduleElection();
      }
    } catch (error) {
      logger.warn({ err: error }, 'Radar worker leader election failed; retrying');
      scheduleElection();
    }
  };

  return {
    processNext,
    start: elect,
    stop: async () => {
      if (electionTimer) clearTimeout(electionTimer);
      electionTimer = undefined;
      if (timer) clearInterval(timer);
      timer = undefined;
      const current = lease;
      lease = null;
      await current?.release();
    },
  }
}
