import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, gte, inArray, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { acquisitionPlans, auditLogs, candidateContacts, candidateEvidence, companySignals, customers, inboxContacts, radarCandidates, radarJobEvents, radarQueueItems, radarTasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { requireAdmin, requireAuth } from '../plugins/auth.js'
import { enrichCandidateContacts } from '../radar/contact-enrichment.js'
import { hasSearchConfiguration } from '../integrations/search-client.js'
import { hasMapConfiguration } from '../integrations/map-client.js'
import { RADAR_DATA_SOURCES, effectiveRadarDataSources } from '../radar/types.js'
import { getAiReadiness } from '../ai/client.js'
import { acquisitionPlanView, computeNextPlanRunAt, createPlanRun, type AcquisitionScheduleType } from '../radar/acquisition-plans.js'
import { getAcquisitionPlanPerformance } from '../radar/performance.js'
import { getAutomationProductionControl, getAutomationSafetyDecision } from '../radar/production-control.js'
import { cancelPendingAutomatedMessages } from '../outbox/automation-stop.js'
import { getAcquisitionFeedbackLearning } from '../radar/feedback-learning.js'
import { getSalesProgressionSummary } from '../sales/progression-guardian.js'

const taskStatus = z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'])
const candidateStatus = z.enum(['candidate', 'review', 'saved', 'rejected', 'archived'])
const performanceQuery = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) })
const feedbackLearningQuery = z.object({ days: z.coerce.number().int().min(30).max(180).default(90) })

const taskInput = z.object({
  name: z.string().trim().min(1).max(160),
  icp: z.string().trim().min(1).max(240),
  mode: z.string().trim().max(80).default('智能多渠道'),
  strategy: z.string().trim().min(1).max(120).default('目标企业发现'),
  dataSources: z.array(z.enum(RADAR_DATA_SOURCES)).min(1).max(RADAR_DATA_SOURCES.length).optional(),
  intentSignals: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  depth: z.string().trim().max(80).default('标准研究'),
  candidateLimit: z.number().int().min(1).max(10000).default(100),
  knowledgeScope: z.string().trim().max(120).default('全部资料'),
  targetRegion: z.string().trim().max(120).default('全球'),
  researchLanguage: z.string().trim().max(80).default('自动识别'),
  inputSource: z.string().trim().max(160).default('AI 获客'),
  seedUrls: z.array(z.string().trim().url()).max(100).default([]),
})

const taskListQuery = z.object({
  status: taskStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const taskAction = z.object({ action: z.enum(['pause', 'resume', 'cancel', 'retry']) })
const planScheduleInput = z.object({
  scheduleType: z.enum(['manual', 'daily', 'weekdays', 'weekly']).default('weekdays'),
  runTimeLocal: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('08:00'),
  timezone: z.string().trim().min(1).max(80).default('Asia/Shanghai'),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([1, 2, 3, 4, 5]),
  requireAi: z.boolean().default(true),
  automationMode: z.enum(['research_only', 'safe_autopilot']).default('research_only'),
  autoOutreachEnabled: z.boolean().default(false),
  minAutoScore: z.number().int().min(55).max(100).default(90),
  dailyCandidateLimit: z.number().int().min(1).max(10000).default(100),
  runImmediately: z.boolean().default(true),
})
const planInput = taskInput.merge(planScheduleInput)
const planUpdateInput = taskInput.partial().merge(planScheduleInput.omit({ runImmediately: true }).partial())
const planAction = z.object({ action: z.enum(['pause', 'resume', 'run', 'archive']) })
const automationControlAction = z.object({ action: z.enum(['pause_all', 'resume_all']) })

const evidenceInput = z.object({
  title: z.string().trim().min(1).max(240),
  source: z.string().trim().min(1).max(160),
  time: z.string().trim().max(80).default('待确认'),
  strength: z.enum(['强', '中', '弱']).default('中'),
  sourceUrl: z.string().trim().url().nullable().optional(),
})

const dimensionInput = z.object({ label: z.string().trim().min(1).max(80), score: z.number().int().min(0).max(100) })
const committeeInput = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120),
  influence: z.string().trim().max(80),
  contact: z.string().trim().max(160),
})
const relationshipInput = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(240) })

const candidateInput = z.object({
  radarTaskId: z.string().trim().min(1).nullable().optional(),
  company: z.string().trim().min(1).max(160),
  region: z.string().trim().max(80).default('待补全'),
  industry: z.string().trim().max(120).default('待补全'),
  size: z.string().trim().max(80).default('待补全'),
  score: z.number().int().min(0).max(100).default(0),
  signal: z.string().trim().max(160).default('待识别'),
  source: z.string().trim().max(120).default('数据源'),
  estimatedValue: z.number().int().min(0).default(0),
  currency: z.enum(['CNY', 'EUR', 'USD']).default('CNY'),
  confidence: z.number().int().min(0).max(100).default(0),
  status: candidateStatus.default('candidate'),
  reason: z.string().trim().max(1000).default('等待补充研究结论'),
  dimensions: z.array(dimensionInput).max(20).default([]),
  evidence: z.array(evidenceInput).max(100).default([]),
  committee: z.array(committeeInput).max(50).default([]),
  relationships: z.array(relationshipInput).max(50).default([]),
})

const candidatePatch = z.object({ status: candidateStatus })
const candidateListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: candidateStatus.optional(),
  taskId: z.string().trim().min(1).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'score_desc', 'score_asc', 'company_asc']).default('updated_desc'),
})

const queueListQuery = z.object({
  taskId: z.string().trim().min(1).optional(),
  status: taskStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const safeJson = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T } catch { return fallback }
}

const taskView = (item: typeof radarTasks.$inferSelect) => ({
  ...item,
  seedUrls: safeJson<string[]>(item.seedUrlsJson, []),
  dataSources: effectiveRadarDataSources({ mode: item.mode, dataSources: safeJson<string[]>(item.dataSourcesJson, []), seedUrls: safeJson<string[]>(item.seedUrlsJson, []) }),
  intentSignals: safeJson<string[]>(item.intentSignalsJson, []),
})

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityType: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType, entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

const refreshTaskCounts = async (workspaceId: string, radarTaskId: string) => {
  const summary = (await db.$first(db.select({
      total: sql<number>`count(*)`,
      highMatch: sql<number>`sum(case when ${radarCandidates.score} >= 90 then 1 else 0 end)`,
    }).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, workspaceId), eq(radarCandidates.radarTaskId, radarTaskId)))))
  await db.update(radarTasks).set({ candidatesFound: summary?.total ?? 0, highMatchCount: summary?.highMatch ?? 0, updatedAt: Date.now() })
        .where(and(eq(radarTasks.id, radarTaskId), eq(radarTasks.workspaceId, workspaceId)))
}

export const radarRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/plans', async request => {
    const items = (await db.select().from(acquisitionPlans)
      .where(and(eq(acquisitionPlans.workspaceId, request.auth.workspaceId), or(eq(acquisitionPlans.status, 'active'), eq(acquisitionPlans.status, 'paused'), eq(acquisitionPlans.status, 'blocked'))))
      .orderBy(desc(acquisitionPlans.updatedAt))).map(acquisitionPlanView)
    return { items, page: 1, pageSize: items.length, total: items.length }
  })

  app.post('/plans', async (request, reply) => {
    const parsed = planInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const input = parsed.data
    const now = Date.now()
    const selectedDataSources = input.dataSources ?? effectiveRadarDataSources({ mode: input.mode, dataSources: [], seedUrls: input.seedUrls })
    const selected = new Set(selectedDataSources)
    const [hasSearch, hasMap] = await Promise.all([hasSearchConfiguration(request.auth.workspaceId), hasMapConfiguration(request.auth.workspaceId)])
    const sourcesReady = (selected.has('search') && hasSearch)
      || (selected.has('map') && hasMap)
      || ((selected.has('website') || selected.has('seed-list')) && input.seedUrls.length > 0)
      || ([...selected].some(source => ['industry-directory', 'trade-show', 'procurement'].includes(source)) && (hasSearch || input.seedUrls.length > 0))
    if (!sourcesReady) return reply.code(409).send({ error: 'DATA_SOURCE_REQUIRED', message: '所选数据源尚未就绪。请先配置搜索或地图 API，或填写可直接研究的公开来源网址。' })
    const { seedUrls, dataSources: _requestedDataSources, intentSignals, weekdays, runImmediately, ...fields } = input
    const readiness = await getAiReadiness(request.auth.workspaceId)
    const enabled = fields.scheduleType !== 'manual'
    const blocked = enabled && fields.requireAi && !readiness.ready
    const record = {
      id: createId('acq'), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId,
      ...fields, dataSourcesJson: JSON.stringify(selectedDataSources), intentSignalsJson: JSON.stringify(intentSignals),
      seedUrlsJson: JSON.stringify(seedUrls), weekdaysJson: JSON.stringify(weekdays),
      enabled, status: blocked ? 'blocked' : enabled ? 'active' : 'paused',
      autoPromoteEnabled: fields.automationMode === 'safe_autopilot', autoOutreachEnabled: fields.automationMode === 'safe_autopilot' && fields.autoOutreachEnabled,
      nextRunAt: enabled ? (blocked ? now + 15 * 60_000 : computeNextPlanRunAt({ scheduleType: fields.scheduleType, runTimeLocal: fields.runTimeLocal, timezone: fields.timezone, weekdays, from: now })) : null,
      lastRunAt: null, lastSuccessAt: null, lastError: blocked ? readiness.message : null,
      consecutiveFailures: 0, totalRuns: 0, createdAt: now, updatedAt: now,
    }
    await db.insert(acquisitionPlans).values(record)
    let initialRun: Awaited<ReturnType<typeof createPlanRun>> | null = null
    if (runImmediately && (!fields.requireAi || readiness.ready)) initialRun = await createPlanRun(record, 'manual')
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.plan.created', 'acquisition_plan', record.id, { scheduleType: record.scheduleType, runImmediately: Boolean(initialRun) })
    const saved = await db.$first(db.select().from(acquisitionPlans).where(eq(acquisitionPlans.id, record.id)))
    return reply.code(201).send({ plan: acquisitionPlanView(saved ?? record), initialRun, aiReadiness: readiness })
  })

  app.patch('/plans/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = planUpdateInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = await db.$first(db.select().from(acquisitionPlans).where(and(eq(acquisitionPlans.id, id), eq(acquisitionPlans.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '获客计划不存在。' })
    const input = parsed.data
    const next = {
      ...existing,
      ...input,
      dataSourcesJson: input.dataSources ? JSON.stringify(input.dataSources) : existing.dataSourcesJson,
      intentSignalsJson: input.intentSignals ? JSON.stringify(input.intentSignals) : existing.intentSignalsJson,
      seedUrlsJson: input.seedUrls ? JSON.stringify(input.seedUrls) : existing.seedUrlsJson,
      weekdaysJson: input.weekdays ? JSON.stringify(input.weekdays) : existing.weekdaysJson,
    }
    const enabled = next.scheduleType !== 'manual' && existing.enabled
    const nextRunAt = enabled ? computeNextPlanRunAt({ scheduleType: next.scheduleType as AcquisitionScheduleType, runTimeLocal: next.runTimeLocal, timezone: next.timezone, weekdays: safeJson(next.weekdaysJson, []), from: Date.now() }) : null
    const { dataSources, intentSignals, seedUrls, weekdays, ...scalarInput } = input
    const nextAutomationMode = next.automationMode as 'research_only' | 'safe_autopilot'
    const nextAutoOutreachEnabled = nextAutomationMode === 'safe_autopilot' && Boolean(next.autoOutreachEnabled)
    await db.update(acquisitionPlans).set({
      ...scalarInput,
      ...(scalarInput.automationMode ? { autoPromoteEnabled: scalarInput.automationMode === 'safe_autopilot' } : {}),
      autoOutreachEnabled: nextAutoOutreachEnabled,
      ...(dataSources ? { dataSourcesJson: JSON.stringify(dataSources) } : {}),
      ...(intentSignals ? { intentSignalsJson: JSON.stringify(intentSignals) } : {}),
      ...(seedUrls ? { seedUrlsJson: JSON.stringify(seedUrls) } : {}),
      ...(weekdays ? { weekdaysJson: JSON.stringify(weekdays) } : {}),
      nextRunAt, updatedAt: Date.now(),
    }).where(eq(acquisitionPlans.id, id))
    const saved = await db.$first(db.select().from(acquisitionPlans).where(eq(acquisitionPlans.id, id)))
    return acquisitionPlanView(saved!)
  })

  app.post('/plans/:id/actions', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = planAction.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = await db.$first(db.select().from(acquisitionPlans).where(and(eq(acquisitionPlans.id, id), eq(acquisitionPlans.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '获客计划不存在。' })
    const now = Date.now()
    if (parsed.data.action === 'run') {
      try {
        const run = await createPlanRun(existing, 'manual')
        await writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.plan.run', 'acquisition_plan', id)
        return { plan: acquisitionPlanView((await db.$first(db.select().from(acquisitionPlans).where(eq(acquisitionPlans.id, id))))!), run }
      } catch (cause) {
        return reply.code(409).send({ error: 'PLAN_NOT_READY', message: cause instanceof Error ? cause.message : '计划暂时无法运行。' })
      }
    }
    const enabled = parsed.data.action === 'resume'
    const archived = parsed.data.action === 'archive'
    const nextRunAt = enabled ? computeNextPlanRunAt({ scheduleType: existing.scheduleType as AcquisitionScheduleType, runTimeLocal: existing.runTimeLocal, timezone: existing.timezone, weekdays: safeJson(existing.weekdaysJson, []), from: now }) : null
    await db.update(acquisitionPlans).set({ enabled, status: archived ? 'archived' : enabled ? 'active' : 'paused', nextRunAt, lastError: enabled ? null : existing.lastError, updatedAt: now }).where(eq(acquisitionPlans.id, id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, `radar.plan.${parsed.data.action}`, 'acquisition_plan', id)
    const saved = await db.$first(db.select().from(acquisitionPlans).where(eq(acquisitionPlans.id, id)))
    return acquisitionPlanView(saved!)
  })

  app.get('/plans/:id/performance', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = performanceQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const performance = await getAcquisitionPlanPerformance({ workspaceId: request.auth.workspaceId, planId: id, days: parsed.data.days })
    if (!performance) return reply.code(404).send({ error: 'NOT_FOUND', message: '获客计划不存在。' })
    return performance
  })

  app.get('/plans/:id/learning', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = feedbackLearningQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const learning = await getAcquisitionFeedbackLearning({ workspaceId: request.auth.workspaceId, planId: id, days: parsed.data.days })
    if (!learning) return reply.code(404).send({ error: 'NOT_FOUND', message: '获客计划不存在。' })
    return learning
  })

  app.get('/automation/control', async request => getAutomationProductionControl(request.auth.workspaceId))

  app.post('/automation/control', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = automationControlAction.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const workspaceId = request.auth.workspaceId
    const now = Date.now()
    if (parsed.data.action === 'pause_all') {
      const plans = await db.select({ id: acquisitionPlans.id }).from(acquisitionPlans).where(and(
        eq(acquisitionPlans.workspaceId, workspaceId), eq(acquisitionPlans.autoOutreachEnabled, true),
        inArray(acquisitionPlans.status, ['active', 'blocked', 'paused']),
      ))
      await db.update(acquisitionPlans).set({ enabled: false, status: 'paused', nextRunAt: null, updatedAt: now }).where(and(
        eq(acquisitionPlans.workspaceId, workspaceId), eq(acquisitionPlans.autoOutreachEnabled, true),
        inArray(acquisitionPlans.status, ['active', 'blocked', 'paused']),
      ))
      const cancelledMessages = await cancelPendingAutomatedMessages({ workspaceId, reason: '管理员已全局暂停自动触达。' })
      await writeAudit(workspaceId, request.auth.userId, 'radar.automation.pause_all', 'workspace', workspaceId, { plans: plans.length, cancelledMessages })
      return { ...(await getAutomationProductionControl(workspaceId)), affectedPlans: plans.length, cancelledMessages }
    }
    const safety = await getAutomationSafetyDecision(workspaceId)
    const control = await getAutomationProductionControl(workspaceId)
    if (!safety.safe || !control.readyToSend) return reply.code(409).send({
      error: 'AUTOMATION_NOT_READY',
      message: control.issues[0]?.description ?? safety.reasons[0] ?? '发送前检查尚未通过。',
      control,
    })
    const plans = await db.select().from(acquisitionPlans).where(and(
      eq(acquisitionPlans.workspaceId, workspaceId), eq(acquisitionPlans.autoOutreachEnabled, true), eq(acquisitionPlans.status, 'paused'),
    ))
    for (const plan of plans) {
      const nextRunAt = computeNextPlanRunAt({
        scheduleType: plan.scheduleType as AcquisitionScheduleType,
        runTimeLocal: plan.runTimeLocal,
        timezone: plan.timezone,
        weekdays: safeJson(plan.weekdaysJson, []),
        from: now,
      })
      await db.update(acquisitionPlans).set({ enabled: true, status: 'active', nextRunAt, lastError: null, updatedAt: now }).where(eq(acquisitionPlans.id, plan.id))
    }
    await writeAudit(workspaceId, request.auth.userId, 'radar.automation.resume_all', 'workspace', workspaceId, { plans: plans.length })
    return { ...(await getAutomationProductionControl(workspaceId)), affectedPlans: plans.length, cancelledMessages: 0 }
  })

  app.get('/automation/brief', async request => {
    const workspaceId = request.auth.workspaceId
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const [planSummary, candidateSummary, taskSummary, nextPlan, aiReadiness, salesGuardian] = await Promise.all([
      db.$first(db.select({
        active: sql<number>`sum(case when ${acquisitionPlans.status} = 'active' then 1 else 0 end)`,
        blocked: sql<number>`sum(case when ${acquisitionPlans.status} = 'blocked' then 1 else 0 end)`,
        paused: sql<number>`sum(case when ${acquisitionPlans.status} = 'paused' then 1 else 0 end)`,
      }).from(acquisitionPlans).where(eq(acquisitionPlans.workspaceId, workspaceId))),
      db.$first(db.select({ total: sql<number>`count(*)`, highMatch: sql<number>`sum(case when ${radarCandidates.score} >= 90 then 1 else 0 end)` }).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, workspaceId), gte(radarCandidates.discoveredAt, today.getTime())))),
      db.$first(db.select({ active: sql<number>`sum(case when ${radarTasks.status} in ('queued','running') then 1 else 0 end)`, failed: sql<number>`sum(case when ${radarTasks.status} = 'failed' and ${radarTasks.updatedAt} >= ${today.getTime()} then 1 else 0 end)` }).from(radarTasks).where(eq(radarTasks.workspaceId, workspaceId))),
      db.$first(db.select().from(acquisitionPlans).where(and(eq(acquisitionPlans.workspaceId, workspaceId), eq(acquisitionPlans.enabled, true))).orderBy(asc(acquisitionPlans.nextRunAt))),
      getAiReadiness(workspaceId),
      getSalesProgressionSummary(workspaceId),
    ])
    return {
      activePlans: planSummary?.active ?? 0, blockedPlans: planSummary?.blocked ?? 0, pausedPlans: planSummary?.paused ?? 0,
      newCandidatesToday: candidateSummary?.total ?? 0, highMatchToday: candidateSummary?.highMatch ?? 0,
      activeRuns: taskSummary?.active ?? 0, failedRunsToday: taskSummary?.failed ?? 0,
      nextRunAt: nextPlan?.nextRunAt ?? null, nextPlanName: nextPlan?.name ?? null, aiReadiness, salesGuardian,
    }
  })

  app.get('/tasks', async (request, reply) => {
    const parsed = taskListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(radarTasks.workspaceId, request.auth.workspaceId)]
    if (query.status) conditions.push(eq(radarTasks.status, query.status))
    const where = and(...conditions)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(radarTasks).where(where)))?.count ?? 0
    const items = (await db.select().from(radarTasks).where(where).orderBy(desc(radarTasks.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(taskView)
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/tasks', async (request, reply) => {
    const parsed = taskInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const hasSeeds = parsed.data.seedUrls.length > 0
    const hasSearch = (await hasSearchConfiguration(request.auth.workspaceId))
    const hasMap = (await hasMapConfiguration(request.auth.workspaceId))
    const selectedDataSources = parsed.data.dataSources ?? effectiveRadarDataSources({ mode: parsed.data.mode, dataSources: [], seedUrls: parsed.data.seedUrls })
    const selected = new Set(selectedDataSources)
    const ready = (selected.has('search') && hasSearch)
      || (selected.has('map') && hasMap)
      || (selected.has('website') && hasSeeds)
      || (selected.has('seed-list') && hasSeeds)
      || ([...selected].some(source => ['industry-directory', 'trade-show', 'procurement'].includes(source)) && (hasSearch || hasSeeds))
    if (!ready) return reply.code(409).send({
      error: 'DATA_SOURCE_REQUIRED',
      message: selected.size === 1 && (selected.has('website') || selected.has('seed-list'))
        ? '该数据源必须填写至少一个企业官网或公开来源网址。'
        : selected.size === 1 && selected.has('map')
          ? '请先在“数据源集成”配置并测试地图 API。'
          : '所选数据源尚未就绪。请配置搜索或地图 API，或填写可直接研究的公开来源网址。',
    })
    const now = Date.now()
    const { seedUrls, dataSources: requestedDataSources, intentSignals, ...taskFields } = parsed.data
    const dataSources = requestedDataSources ?? selectedDataSources
    const record = {
      id: createId('rdr'), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId,
      status: 'queued', progress: 0, currentStage: '等待执行', candidatesFound: 0, highMatchCount: 0,
      lastError: null, startedAt: null, completedAt: null, createdAt: now, updatedAt: now,
      seedUrlsJson:JSON.stringify(seedUrls), dataSourcesJson: JSON.stringify(dataSources), intentSignalsJson: JSON.stringify(intentSignals), ...taskFields,
    }
    const queue = {
      id: createId('job'), workspaceId: request.auth.workspaceId, radarTaskId: record.id, jobType: 'discover',
      status: 'queued', attempts: 0, maxAttempts: 3, scheduledAt: now, startedAt: null, completedAt: null,
      lastError: null, payload: JSON.stringify(parsed.data), createdAt: now, updatedAt: now,
    }
    await db.transaction(async tx => {
            await tx.insert(radarTasks).values(record)
            await tx.insert(radarQueueItems).values(queue)
          })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.task.created', 'radar_task', record.id, { strategy: record.strategy, dataSources, intentSignals, inputSource: record.inputSource })
    return reply.code(201).send({ ...record, seedUrls, dataSources, intentSignals, queueItem: queue })
  })

  app.get('/tasks/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const task = (await db.$first(db.select().from(radarTasks).where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId)))))
    if (!task) return reply.code(404).send({ error: 'NOT_FOUND', message: '雷达任务不存在。' })
    return taskView(task)
  })
  app.patch('/tasks/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = taskAction.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await db.$first(db.select().from(radarTasks).where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '雷达任务不存在。' })
    const latestQueue = (await db.$first(db.select().from(radarQueueItems).where(and(eq(radarQueueItems.radarTaskId, id), eq(radarQueueItems.workspaceId, request.auth.workspaceId))).orderBy(desc(radarQueueItems.createdAt))))
    const action = parsed.data.action
    const allowed = action === 'pause' ? ['queued', 'running'].includes(existing.status)
      : action === 'resume' ? existing.status === 'paused'
      : action === 'cancel' ? ['queued', 'running', 'paused', 'failed'].includes(existing.status)
      : existing.status === 'failed'
    if (!allowed) return reply.code(409).send({ error: 'INVALID_TRANSITION', message: `当前状态不能执行“${action}”。` })
    if (action === 'retry' && latestQueue && latestQueue.attempts >= latestQueue.maxAttempts) return reply.code(409).send({ error: 'RETRY_EXHAUSTED', message: '已达到最大重试次数。' })
    const now = Date.now()
    const nextStatus = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'queued'
    const nextStage = action === 'pause' ? '已暂停' : action === 'cancel' ? '已取消' : '等待执行'
    await db.transaction(async tx => {
            await tx.update(radarTasks).set({ status: nextStatus, currentStage: nextStage, lastError: action === 'retry' ? null : existing.lastError, completedAt: action === 'cancel' ? now : null, updatedAt: now })
                      .where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId)))
            if (latestQueue) await tx.update(radarQueueItems).set({ status: nextStatus, attempts: latestQueue.attempts, lastError: action === 'retry' ? null : latestQueue.lastError, completedAt: action === 'cancel' ? now : null, scheduledAt: action === 'retry' || action === 'resume' ? now : latestQueue.scheduledAt, updatedAt: now })
                    .where(and(eq(radarQueueItems.id, latestQueue.id), eq(radarQueueItems.workspaceId, request.auth.workspaceId)))
          })
    await writeAudit(request.auth.workspaceId, request.auth.userId, `radar.task.${action}`, 'radar_task', id)
    return (await db.$first(db.select().from(radarTasks).where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId)))))
  })

  app.get('/tasks/:id/events', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const task = (await db.$first(db.select({ id: radarTasks.id }).from(radarTasks).where(and(eq(radarTasks.id,id),eq(radarTasks.workspaceId,request.auth.workspaceId)))))
    if(!task)return reply.code(404).send({error:'NOT_FOUND',message:'雷达任务不存在。'})
    const items=(await db.select().from(radarJobEvents).where(and(eq(radarJobEvents.radarTaskId,id),eq(radarJobEvents.workspaceId,request.auth.workspaceId))).orderBy(desc(radarJobEvents.createdAt)).limit(100))
    return {items,total:items.length}
  })

  app.get('/candidates', async (request, reply) => {
    const parsed = candidateListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(radarCandidates.workspaceId, request.auth.workspaceId)]
    if (!query.status) conditions.push(isNull(radarCandidates.archivedAt))
    if (query.q) conditions.push(or(like(radarCandidates.company, `%${query.q}%`), like(radarCandidates.industry, `%${query.q}%`), like(radarCandidates.signal, `%${query.q}%`))!)
    if (query.status) conditions.push(eq(radarCandidates.status, query.status))
    if (query.taskId) conditions.push(eq(radarCandidates.radarTaskId, query.taskId))
    if (query.minScore !== undefined) conditions.push(gte(radarCandidates.score, query.minScore))
    const where = and(...conditions)
    const orderBy = query.sort === 'score_desc' ? desc(radarCandidates.score)
      : query.sort === 'score_asc' ? asc(radarCandidates.score)
      : query.sort === 'company_asc' ? asc(radarCandidates.company)
      : desc(radarCandidates.updatedAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(radarCandidates).where(where)))?.count ?? 0
    const rows = (await db.select().from(radarCandidates).where(where).orderBy(orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize))
    const evidenceRows = rows.length ? (await db.select().from(candidateEvidence).where(and(eq(candidateEvidence.workspaceId, request.auth.workspaceId), inArray(candidateEvidence.candidateId, rows.map(row => row.id)))).orderBy(desc(candidateEvidence.createdAt))) : []
    const contactRows = rows.length ? (await db.select().from(candidateContacts).where(and(eq(candidateContacts.workspaceId, request.auth.workspaceId), inArray(candidateContacts.candidateId, rows.map(row => row.id)))).orderBy(desc(candidateContacts.confidence), desc(candidateContacts.updatedAt))) : []
    const signalRows = rows.length ? (await db.select().from(companySignals).where(and(eq(companySignals.workspaceId, request.auth.workspaceId), inArray(companySignals.candidateId, rows.map(row => row.id)))).orderBy(desc(companySignals.observedAt))) : []
    const items = rows.map(row => ({
      ...row,
      dimensions: safeJson(row.dimensionsJson, []),
      committee: safeJson(row.committeeJson, []),
      relationships: safeJson(row.relationshipsJson, []),
      evidence: evidenceRows.filter(item => item.candidateId === row.id).map(item => ({ id: item.id, title: item.title, source: item.source, time: item.observedLabel, strength: item.strength, sourceUrl: item.sourceUrl })),
      contacts: contactRows.filter(item => item.candidateId === row.id).map(item => ({ id: item.id, name: item.name, role: item.role, email: item.email, phone: item.phone, socialUrl: item.socialUrl, sourceUrl: item.sourceUrl, verificationStatus: item.verificationStatus, confidence: item.confidence })),
      intentSignals: signalRows.filter(item => item.candidateId === row.id).map(item => ({ ...item, metadata: safeJson(item.metadataJson, {}), metadataJson: undefined })),
    }))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/candidates', async (request, reply) => {
    const parsed = candidateInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    if (parsed.data.radarTaskId) {
      const task = (await db.$first(db.select({ id: radarTasks.id }).from(radarTasks).where(and(eq(radarTasks.id, parsed.data.radarTaskId), eq(radarTasks.workspaceId, request.auth.workspaceId)))))
      if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '关联雷达任务不存在。' })
    }
    const taskCondition = parsed.data.radarTaskId
      ? eq(radarCandidates.radarTaskId, parsed.data.radarTaskId)
      : isNull(radarCandidates.radarTaskId)
    const existing = (await db.$first(db.select({ id: radarCandidates.id }).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, request.auth.workspaceId), taskCondition, eq(radarCandidates.company, parsed.data.company)))))
    if (existing) return reply.code(409).send({ error: 'CANDIDATE_EXISTS', message: '该工作区已存在同名候选客户。' })
    const now = Date.now()
    const { dimensions, evidence, committee, relationships, ...fields } = parsed.data
    const record = {
      id: createId('can'), workspaceId: request.auth.workspaceId, discoveredAt: now, updatedAt: now,
      dimensionsJson: JSON.stringify(dimensions), committeeJson: JSON.stringify(committee), relationshipsJson: JSON.stringify(relationships), ...fields,
    }
    await db.transaction(async tx => {
            await tx.insert(radarCandidates).values(record)
            if (evidence.length) await tx.insert(candidateEvidence).values(evidence.map(item => ({
                    id: createId('evd'), workspaceId: request.auth.workspaceId, candidateId: record.id,
                    title: item.title, source: item.source, observedLabel: item.time, strength: item.strength,
                    sourceUrl: item.sourceUrl ?? null, createdAt: now,
                  })))
          })
    if (record.radarTaskId) await refreshTaskCounts(request.auth.workspaceId, record.radarTaskId)
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.created', 'radar_candidate', record.id, { company: record.company, source: record.source })
    return reply.code(201).send({ ...record, dimensions, committee, relationships, evidence })
  })

  app.patch('/candidates/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = candidatePatch.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await db.$first(db.select().from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    await db.update(radarCandidates).set({ status: parsed.data.status, updatedAt: Date.now() }).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId)))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.updated', 'radar_candidate', id, { status: parsed.data.status })
    return (await db.$first(db.select().from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId)))))
  })

  app.post('/candidates/:id/archive', async (request, reply) => {
    const id = (request.params as { id: string }).id; const existing = await db.$first(db.select({ id: radarCandidates.id }).from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    const archivedAt = (request.body as { archived?: boolean } | undefined)?.archived === false ? null : Date.now()
    await db.update(radarCandidates).set({ archivedAt, updatedAt: Date.now(), status: archivedAt ? 'archived' : 'candidate' }).where(eq(radarCandidates.id, id)); await writeAudit(request.auth.workspaceId, request.auth.userId, archivedAt ? 'radar.candidate.archived' : 'radar.candidate.unarchived', 'radar_candidate', id)
    return { id, archivedAt }
  })

  app.post('/candidates/:id/enrich-contacts', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const candidate = (await db.$first(db.select({ id: radarCandidates.id, company: radarCandidates.company }).from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId)))))
    if (!candidate) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    const result = await enrichCandidateContacts(request.auth.workspaceId, id)
    if (!result) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.contacts_enriched', 'radar_candidate', id, { discovered: result.discovered, pagesScanned: result.pagesScanned })
    return { ...result, message: result.discovered ? `已发现 ${result.discovered} 条新的公开联系方式。` : result.contacts.length ? '未发现新的联系方式，已保留现有结果。' : '未在公开页面中发现可验证的联系方式。' }
  })
  app.post('/candidates/:id/promote', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const candidate = (await db.$first(db.select().from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId)))))
    if (!candidate) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })

    // Choose the best reachable contact: verified email first, then any email, then phone-only.
    const contacts = (await db.select().from(candidateContacts).where(and(eq(candidateContacts.workspaceId, request.auth.workspaceId), eq(candidateContacts.candidateId, id))).orderBy(desc(candidateContacts.confidence), desc(candidateContacts.updatedAt)))
    const bestContact = contacts.find(c => c.email && c.verificationStatus === 'verified')
      ?? contacts.find(c => c.email)
      ?? contacts[0]
      ?? null

    const now = Date.now()
    const existingCustomer = (await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), eq(customers.company, candidate.company)))))
    const validContacts = contacts.filter(c => c.verificationStatus === 'verified').length

    let customer = existingCustomer
    let newCustomer: NonNullable<typeof existingCustomer> | null = null
    let contactCreated = false
    await db.transaction(async (tx) => {
            if (!customer) {
              newCustomer = {
                id: createId('cus'),
                workspaceId: request.auth.workspaceId,
                company: candidate.company,
                region: candidate.region,
                industry: candidate.industry,
                score: candidate.score,
                confidence: candidate.confidence,
                signal: candidate.signal,
                source: candidate.source,
                estimatedValue: candidate.estimatedValue,
                size: candidate.size,
                stage: candidate.score >= 90 ? '重点跟进' : '培育中',
                contacts: contacts.length,
                validContacts,
                interaction: '刚刚 · AI 获客保存',
                nextAction: bestContact?.email ? '安排首次触达' : '补全联系人邮箱',
                ownerUserId: request.auth.userId,
                dueAt: null,
                archivedAt: null,
                scoreOverride: null,
                scoreOverrideReason: null,
                scoreOverrideByUserId: null,
                scoreOverrideAt: null,
                createdAt: now,
                updatedAt: now,
              }
              customer = newCustomer
              try { await tx.insert(customers).values(newCustomer) }
              catch { customer = (await db.$first(tx.select().from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), eq(customers.company, candidate.company)))))! }
            } else {
              await tx.update(customers).set({ contacts: Math.max(existingCustomer!.contacts, contacts.length), validContacts: Math.max(existingCustomer!.validContacts, validContacts), updatedAt: now }).where(eq(customers.id, existingCustomer!.id))
              customer = (await db.$first(tx.select().from(customers).where(eq(customers.id, existingCustomer!.id)))) ?? existingCustomer
            }

            // Create an inbox contact (with verified email) so campaigns can actually send to this customer.
            if (bestContact?.email) {
              const existingInbox = (await db.$first(tx.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.email, bestContact.email)))))
              if (!existingInbox) {
                await tx.insert(inboxContacts).values({
                              id: createId('ict'),
                              workspaceId: request.auth.workspaceId,
                              customerId: customer!.id,
                              name: bestContact.name || customer!.company,
                              company: customer!.company,
                              jobTitle: bestContact.role || '待补全',
                              region: customer!.region,
                              source: 'AI 获客',
                              primaryChannel: '邮件',
                              email: bestContact.email,
                              phone: bestContact.phone,
                              verificationStatus: bestContact.verificationStatus === 'verified' ? 'verified' : 'unverified',
                              verifiedAt: bestContact.verificationStatus === 'verified' ? now : null,
                              verificationSource: bestContact.verificationStatus === 'verified' ? 'AI 获客自动验证' : null,
                              createdAt: now,
                              updatedAt: now,
                            })
                contactCreated = true
              } else if (!existingInbox.customerId) {
                await tx.update(inboxContacts).set({ customerId: customer!.id, updatedAt: now }).where(eq(inboxContacts.id, existingInbox.id))
              }
            }

            await tx.update(radarCandidates).set({ status: 'saved', updatedAt: now }).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId)))
            await tx.update(companySignals).set({ customerId: customer!.id }).where(and(eq(companySignals.workspaceId, request.auth.workspaceId), eq(companySignals.candidateId, id)))
          })

    await writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.promoted', 'customer', customer!.id, { candidateId: id, company: candidate.company, contactEmail: bestContact?.email ?? null, contactCreated })
    return reply.code(existingCustomer ? 200 : 201).send({ customer, contact: bestContact, contactCreated, reachable: Boolean(bestContact?.email), created: !existingCustomer })
  })

  app.get('/queue', async (request, reply) => {
    const parsed = queueListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(radarQueueItems.workspaceId, request.auth.workspaceId)]
    if (query.taskId) conditions.push(eq(radarQueueItems.radarTaskId, query.taskId))
    if (query.status) conditions.push(eq(radarQueueItems.status, query.status))
    const where = and(...conditions)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(radarQueueItems).where(where)))?.count ?? 0
    const items = (await db.select().from(radarQueueItems).where(where).orderBy(desc(radarQueueItems.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })
}
