import { and, asc, eq, lte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { config } from '../config.js'
import { acquireLeaderLease, LEADER_KEYS, type LeaderLease } from '../lib/leader-lock.js'
import { logger } from '../logger.js'
import { acquisitionPlans, candidateEvidence, radarCandidates, radarJobEvents, radarQueueItems, radarTasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { hasAiConfiguration } from '../ai/client.js'
import { enrichCandidateWithAi } from './ai-enrichment.js'
import { enrichCandidateContacts } from './contact-enrichment.js'
import { isLikelyCompanyName, WebsiteSeedConnector } from './connectors/website-seed.js'
import { SearchDiscoveryConnector } from './connectors/search-discovery.js'
import { MapDiscoveryConnector } from './connectors/map-discovery.js'
import { IndustrySourceConnector } from './connectors/industry-source.js'
import { ConnectorError, type DiscoveredCandidate, type DiscoveryConnector, type RadarTaskContext } from './types.js'
import { isLikelyOverseasProspect } from './connectors/prospect-quality.js'
import { detectIntentSignals, storeCandidateSignals } from './signal-engine.js'
import { dispatchDueAcquisitionPlans, updatePlanAfterRun } from './acquisition-plans.js'
import { getAcquisitionPlanPerformance } from './performance.js'
import { rankDiscoveryConnectors } from './optimization.js'
import { applyAcquisitionFeedback, getAcquisitionFeedbackLearning } from './feedback-learning.js'

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
  const existing = (await db.$first(db.select().from(radarCandidates).where(and(
    eq(radarCandidates.workspaceId, workspaceId),
    sql`lower(trim(${radarCandidates.company})) = lower(trim(${candidate.company}))`,
  ))))
  if (existing) {
    const currentEvidence = (await db.select({ sourceUrl: candidateEvidence.sourceUrl }).from(candidateEvidence).where(and(eq(candidateEvidence.workspaceId, workspaceId), eq(candidateEvidence.candidateId, existing.id))))
    const knownUrls = new Set(currentEvidence.map(item => item.sourceUrl))
    const newEvidence = candidate.evidence.filter(item => !knownUrls.has(item.sourceUrl))
    const currentRelationships = parseJson<{ label: string; value: string }[]>(existing.relationshipsJson, [])
    const relationshipKeys = new Set(currentRelationships.map(item => `${item.label}\u0000${item.value}`))
    const mergedRelationships = [...currentRelationships, ...candidate.relationships.filter(item => !relationshipKeys.has(`${item.label}\u0000${item.value}`))]
    const existingSources = new Set(existing.source.split(' · ').filter(Boolean))
    const candidateSources = candidate.source.split(' · ').filter(Boolean)
    const crossVerified = candidateSources.some(source => !existingSources.has(source))
    const sources = [...new Set([...existingSources, ...candidateSources])].join(' · ')
    const signals = [...new Set([existing.signal, candidate.signal].flatMap(item => item.split(' · ')).filter(Boolean))].join(' · ')
    const currentDimensions = parseJson<{ label: string; score: number }[]>(existing.dimensionsJson, [])
    const sourceDimension = { label: '多来源验证', score: Math.min(100, 55 + sources.split(' · ').length * 12) }
    const dimensions = [...currentDimensions.filter(item => item.label !== sourceDimension.label), sourceDimension]
    const now = Date.now()
    await db.transaction(async tx => {
            await tx.update(radarCandidates).set({
                      region: existing.region === '待补全' ? candidate.region : existing.region,
                      industry: existing.industry === '待补全' ? candidate.industry : existing.industry,
                      score: Math.min(98, Math.max(existing.score, candidate.score) + (crossVerified ? 4 : 0)),
                      confidence: Math.min(98, Math.max(existing.confidence, candidate.confidence) + (crossVerified ? 6 : 0)),
                      signal: signals,
                      source: sources,
                      reason: crossVerified ? `${existing.reason}；该企业已获得多个独立公开来源交叉验证。` : existing.reason,
                      dimensionsJson: JSON.stringify(dimensions),
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
        strategy: task.strategy, dataSources: parseJson(task.dataSourcesJson, []), intentSignals: parseJson(task.intentSignalsJson, []),
        depth: task.depth, candidateLimit: task.candidateLimit, targetRegion: task.targetRegion,
        researchLanguage: task.researchLanguage, seedUrls: parseJson(task.seedUrlsJson, []),
      }
      const automationPlan = task.acquisitionPlanId
        ? await db.$first(db.select().from(acquisitionPlans).where(and(eq(acquisitionPlans.id, task.acquisitionPlanId), eq(acquisitionPlans.workspaceId, task.workspaceId))))
        : null
      const fullAutomationEnabled = Boolean(automationPlan?.autoOutreachEnabled && automationPlan.automationMode === 'safe_autopilot')
      let feedbackModel: Awaited<ReturnType<typeof getAcquisitionFeedbackLearning>> = null
      const supported = await Promise.all(connectors.map(connector => connector.supports(context)))
      let available = connectors.filter((_, index) => supported[index])
      if (!available.length) throw new ConnectorError('没有可执行的数据源。请先配置搜索或地图数据源，或为官网、行业名录、展会协会和招投标任务填写至少一个公开来源网址。')
      if (automationPlan) {
        try {
          const performance = await getAcquisitionPlanPerformance({ workspaceId: task.workspaceId, planId: automationPlan.id, days: 30 })
          const sourceSample = performance?.sources.reduce((sum, source) => sum + source.candidates, 0) ?? 0
          if (performance && sourceSample >= 10) {
            const originalOrder = available.map(connector => connector.id).join(',')
            available = rankDiscoveryConnectors(available, performance.sources)
            const optimizedOrder = available.map(connector => connector.id).join(',')
            await addEvent(task.workspaceId, task.id, queue.id, 'sources.optimized', originalOrder === optimizedOrder
              ? '数据源优先级已复盘，本轮保持当前顺序'
              : `已根据近 30 天质量与回复表现调整数据源顺序：${available.map(connector => connector.label).join(' → ')}`,
            'info', { sample: sourceSample, sources: performance.sources.slice(0, 5) })
          }
        } catch {
          await addEvent(task.workspaceId, task.id, queue.id, 'sources.optimization_skipped', '来源表现复盘暂不可用，本轮保持计划原始顺序', 'info')
        }
        try {
          feedbackModel = await getAcquisitionFeedbackLearning({ workspaceId: task.workspaceId, planId: automationPlan.id, days: 90 })
          await addEvent(task.workspaceId, task.id, queue.id, 'feedback.learning_ready', feedbackModel?.message ?? '客户结果反馈暂不可用，本轮保持基础评分', 'info', {
            status: feedbackModel?.status ?? 'unavailable', labeledOutcomes: feedbackModel?.labeledOutcomes ?? 0,
          })
        } catch {
          await addEvent(task.workspaceId, task.id, queue.id, 'feedback.learning_skipped', '客户结果反馈暂不可用，本轮保持基础评分', 'info')
        }
      }
      let discovered = 0
      const aiEnabled = (await hasAiConfiguration(task.workspaceId))
      let aiEnrichedCount = 0
      let aiBudgetEventWritten = false
      const maxAiEnrichments = Math.min(fullAutomationEnabled ? 20 : 5, task.candidateLimit)
      if (!aiEnabled) await addEvent(task.workspaceId, task.id, queue.id, 'ai.skipped', '未配置可用 AI 服务，本次使用公开证据完成基础研究', 'info')
      for (const [connectorIndex, connector] of available.entries()) {
        const discoveredBeforeConnector = discovered
        const remaining = Math.max(0, task.candidateLimit - discovered)
        if (!remaining) break
        const remainingConnectors = available.length - connectorIndex
        const connectorLimit = context.mode === '智能多渠道' ? Math.max(1, Math.ceil(remaining / remainingConnectors)) : remaining
        const connectorContext = { ...context, candidateLimit: connectorLimit }
        await addEvent(task.workspaceId, task.id, queue.id, 'connector.started', `正在运行：${connector.label}`, 'info', { connectorId: connector.id })
        const discoveredResults = await connector.discover(connectorContext, async (message, progress) => {
          const nextProgress = Math.max(5, Math.min(progress, 90))
          await db.update(radarTasks).set({
            progress: sql<number>`max(${radarTasks.progress}, ${nextProgress})`,
            currentStage: message,
            updatedAt: Date.now(),
          }).where(eq(radarTasks.id, task.id))
        })
        const results = discoveredResults.slice(0, Math.max(0, task.candidateLimit - discovered))
        for (const [resultIndex, candidate] of results.entries()) {
          const researchProgress = Math.min(96, 80 + Math.round(((connectorIndex + ((resultIndex + 1) / Math.max(results.length, 1))) / Math.max(available.length, 1)) * 16))
          await db.update(radarTasks).set({
            progress: sql<number>`max(${radarTasks.progress}, ${researchProgress})`,
            currentStage: `正在研究候选 ${resultIndex + 1}/${results.length}：${candidate.company}`,
            updatedAt: Date.now(),
          }).where(eq(radarTasks.id, task.id))
          let researched = candidate
          if (aiEnabled && aiEnrichedCount < maxAiEnrichments) {
            aiEnrichedCount += 1
            let timeout: ReturnType<typeof setTimeout> | undefined
            try {
              const enrichment = await Promise.race([
                enrichCandidateWithAi(connectorContext, candidate),
                new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('AI 研究超过 20 秒，已保留公开证据结果')), 20_000); timeout.unref?.() }),
              ])
              researched = enrichment.candidate
              await addEvent(task.workspaceId, task.id, queue.id, 'ai.enriched', `${candidate.company} 已完成 AI 证据研究`, 'info', { serviceName: enrichment.serviceName, model: enrichment.model, latencyMs: enrichment.latencyMs })
            } catch (cause) {
              await addEvent(task.workspaceId, task.id, queue.id, 'ai.degraded', `${candidate.company} 的 AI 深度研究未在时限内完成，已保留公开证据结果`, 'warning', { reason: cause instanceof Error ? cause.message : 'AI 研究未完成' })
            } finally {
              if (timeout) clearTimeout(timeout)
            }
          } else if (aiEnabled && !aiBudgetEventWritten) {
            aiBudgetEventWritten = true
            await addEvent(task.workspaceId, task.id, queue.id, 'ai.budget_reached', `本次已对前 ${maxAiEnrichments} 家候选执行 AI 深度研究，其余候选保留公开证据并进入人工复核`, 'info', { limit: maxAiEnrichments })
          }
          const relevanceInput = {
            company: researched.company,
            industry: researched.industry + ' ' + candidate.industry,
            signal: researched.signal + ' ' + candidate.signal,
            reason: researched.reason + ' ' + candidate.reason,
            source: researched.source + ' ' + candidate.source,
            icp: task.icp,
          }
          if (!isLikelyCompanyName(researched.company)) {
            await addEvent(task.workspaceId, task.id, queue.id, 'prospect.filtered_entity', `${researched.company} 不是可确认的企业名称，已排除`, 'info')
            continue
          }
          const signalResult = detectIntentSignals(connectorContext, researched)
          researched = signalResult.candidate
          if (feedbackModel) {
            const learned = applyAcquisitionFeedback(feedbackModel, researched)
            researched = learned.candidate
            if (learned.adjustment) await addEvent(task.workspaceId, task.id, queue.id, 'feedback.score_adjusted', `${researched.company} 已根据历史结果校准 ${learned.adjustment > 0 ? '+' : ''}${learned.adjustment} 分`, 'info', {
              adjustment: learned.adjustment,
              features: learned.matchedFeatures.map(feature => ({ kind: feature.kind, label: feature.label, samples: feature.samples, adjustment: feature.adjustment })),
            })
          }
          if (researched.score < 55) {
            await addEvent(task.workspaceId, task.id, queue.id, 'prospect.filtered_quality', `${researched.company} 匹配分过低，已排除`, 'info')
            continue
          }
          if (!isLikelyOverseasProspect(relevanceInput)) {
            await addEvent(task.workspaceId, task.id, queue.id, 'prospect.filtered_relevance', `${researched.company} 与目标客户画像不匹配，已排除`, 'info')
            continue
          }
          const result = (await saveCandidate(task.workspaceId, task.id, researched))
          const storedSignals = await storeCandidateSignals({ workspaceId: task.workspaceId, candidateId: result.id, company: researched.company, signals: signalResult.signals })
          if (storedSignals) await addEvent(task.workspaceId, task.id, queue.id, 'signals.detected', `${candidate.company} 发现 ${storedSignals} 条有证据的意向信号`, 'info', { types: signalResult.signals.map(signal => signal.signalType) })
          if (result.created) discovered += 1
          const liveCounts = await taskCounts(task.workspaceId, task.id)
          await db.update(radarTasks).set({
            candidatesFound: liveCounts?.total ?? 0,
            highMatchCount: liveCounts?.highMatch ?? 0,
            updatedAt: Date.now(),
          }).where(eq(radarTasks.id, task.id))
          const needsAutomaticContactVerification = Boolean(fullAutomationEnabled && researched.score >= (automationPlan?.minAutoScore ?? 90))
          if (result.created && (/深度/.test(connectorContext.depth) || needsAutomaticContactVerification)) {
            try {
              const contactResult = await enrichCandidateContacts(task.workspaceId, result.id)
              await addEvent(task.workspaceId, task.id, queue.id, 'contacts.enriched', contactResult?.discovered ? `${candidate.company} 已发现 ${contactResult.discovered} 条公开联系方式` : `${candidate.company} 未发现可验证的公开联系方式`, 'info', { discovered: contactResult?.discovered ?? 0, pagesScanned: contactResult?.pagesScanned ?? 0 })
            } catch (cause) {
              await addEvent(task.workspaceId, task.id, queue.id, 'contacts.degraded', `${candidate.company} 的公开联系人补全未完成，候选研究结果已保留`, 'warning', { reason: cause instanceof Error ? cause.message : '联系人补全失败' })
            }
          }
        }
        const connectorDiscovered = discovered - discoveredBeforeConnector
        await addEvent(task.workspaceId, task.id, queue.id, 'connector.completed', `${connector.label}完成，新增 ${connectorDiscovered} 家候选`, 'info', { connectorId: connector.id, discovered: connectorDiscovered })
      }
      const counts = (await taskCounts(task.workspaceId, task.id))
      const completedAt = Date.now()
      await db.transaction(async tx => {
                await tx.update(radarTasks).set({ status: 'completed', progress: 100, currentStage: '研究完成', candidatesFound: counts?.total ?? 0, highMatchCount: counts?.highMatch ?? 0, completedAt, updatedAt: completedAt }).where(eq(radarTasks.id, task.id))
                await tx.update(radarQueueItems).set({ status: 'completed', completedAt, updatedAt: completedAt }).where(eq(radarQueueItems.id, queue.id))
              })
      const automation = await updatePlanAfterRun(task, true)
      if (automation.promoted) await addEvent(task.workspaceId, task.id, queue.id, 'autopilot.promoted', `安全自动推进已将 ${automation.promoted} 家高质量候选保存至客户库，并创建人工复核任务`, 'info', { promoted: automation.promoted })
      if (automation.outreachQueued) await addEvent(task.workspaceId, task.id, queue.id, 'autopilot.outreach_queued', `已为 ${automation.outreachQueued} 家通过安全门槛的客户生成个性化首触达并进入发送队列`, 'info', { queued: automation.outreachQueued })
      if (automation.outreachSkipped) await addEvent(task.workspaceId, task.id, queue.id, 'autopilot.outreach_skipped', `${automation.outreachSkipped} 家客户因验证、抑制、重复触达或发送服务门槛未自动发送`, 'warning', { skipped: automation.outreachSkipped })
      if (automation.error) await addEvent(task.workspaceId, task.id, queue.id, 'autopilot.degraded', automation.error, 'warning')
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
      if (!shouldRetry) {
        const failedTask = await db.$first(db.select().from(radarTasks).where(eq(radarTasks.id, queue.radarTaskId)))
        if (failedTask) await updatePlanAfterRun(failedTask, false, message)
      }
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
    const tick = async () => {
      try {
        await dispatchDueAcquisitionPlans()
        await processNext()
      } catch (error) {
        logger.error({ err: error }, 'Radar automation tick failed')
      }
    }
    void tick();
    timer = setInterval(() => { void tick() }, intervalMs);
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
