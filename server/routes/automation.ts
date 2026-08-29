import type { FastifyPluginAsync } from 'fastify'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import {
  acquisitionPlans, automationEvents, automationRuns, customerOutcomes, deals, learningSnapshots,
  radarQueueItems, radarTasks, replySuggestions, salesRecommendations, tasks, workspaceNotifications,
} from '../db/schema.js'
import {
  createLearningSnapshot, generateSalesRecommendation, persistReplySuggestion, reconcileClosedLoop,
  recordOutcome, replySuggestionView,
} from '../automation/closed-loop.js'
import { createId } from '../lib/ids.js'
import { requireAuth } from '../plugins/auth.js'
import { getAutomationSafetyDecision } from '../radar/production-control.js'

const outcomeInput = z.object({
  customerId: z.string().trim().min(1).nullable().optional(), dealId: z.string().trim().min(1).nullable().optional(),
  threadId: z.string().trim().min(1).nullable().optional(),
  outcome: z.enum(['replied_high_intent', 'qualified', 'disqualified', 'won', 'lost', 'unsubscribed', 'bounced', 'deferred']),
  reasonCode: z.string().trim().max(80).nullable().optional(), note: z.string().trim().max(1000).default(''),
  occurredAt: z.number().int().optional(),
})

const parseJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T } catch { return fallback } }
const recommendationView = (row: typeof salesRecommendations.$inferSelect) => ({ ...row, missingInformation: parseJson<string[]>(row.missingInformationJson, []) })
const runView = (row: typeof automationRuns.$inferSelect) => ({ ...row, input: parseJson(row.inputJson, {}), result: parseJson(row.resultJson, {}) })
const eventView = (row: typeof automationEvents.$inferSelect) => ({ ...row, metadata: parseJson(row.metadataJson, {}) })
const learningView = (row: typeof learningSnapshots.$inferSelect) => ({ ...row, positiveRate: row.positiveRate / 10, model: parseJson(row.modelJson, {}) })

export const automationRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/notifications', async request => {
    const rows = await db.select().from(workspaceNotifications).where(and(
      eq(workspaceNotifications.workspaceId, request.auth.workspaceId),
      sql`(${workspaceNotifications.userId} is null or ${workspaceNotifications.userId} = ${request.auth.userId})`,
    )).orderBy(desc(workspaceNotifications.createdAt)).limit(100)
    return { items: rows, unreadTotal: rows.filter(row => !row.readAt).length, total: rows.length }
  })

  app.post('/notifications/read-all', async request => {
    const now = Date.now()
    await db.update(workspaceNotifications).set({ readAt: now, updatedAt: now }).where(and(
      eq(workspaceNotifications.workspaceId, request.auth.workspaceId), isNull(workspaceNotifications.readAt),
      sql`(${workspaceNotifications.userId} is null or ${workspaceNotifications.userId} = ${request.auth.userId})`,
    ))
    return { readAt: now }
  })

  app.post('/notifications/:id/read', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = await db.$first(db.select().from(workspaceNotifications).where(and(eq(workspaceNotifications.id, id), eq(workspaceNotifications.workspaceId, request.auth.workspaceId))))
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '通知不存在。' })
    const now = Date.now(); await db.update(workspaceNotifications).set({ readAt: now, updatedAt: now }).where(eq(workspaceNotifications.id, id))
    return { id, readAt: now }
  })

  app.get('/outcomes', async request => {
    const rows = await db.select().from(customerOutcomes).where(eq(customerOutcomes.workspaceId, request.auth.workspaceId)).orderBy(desc(customerOutcomes.occurredAt)).limit(200)
    return { items: rows, total: rows.length }
  })

  app.post('/outcomes', async (request, reply) => {
    const parsed = outcomeInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    return reply.code(201).send(await recordOutcome({ workspaceId: request.auth.workspaceId, actorUserId: request.auth.userId, ...parsed.data }))
  })

  app.get('/reply-suggestions/:threadId', async (request, reply) => {
    const threadId = (request.params as { threadId: string }).threadId
    const row = await db.$first(db.select().from(replySuggestions).where(and(
      eq(replySuggestions.workspaceId, request.auth.workspaceId), eq(replySuggestions.threadId, threadId), isNull(replySuggestions.supersededAt),
    )).orderBy(desc(replySuggestions.version)))
    if (row) return replySuggestionView(row)
    const generated = await persistReplySuggestion({ workspaceId: request.auth.workspaceId, threadId })
    if (!generated) return reply.code(404).send({ error: 'NOT_FOUND', message: '回复建议尚未生成。' })
    return generated
  })

  app.post('/reply-suggestions/:threadId/generate', async (request, reply) => {
    const threadId = (request.params as { threadId: string }).threadId
    const suggestion = await persistReplySuggestion({ workspaceId: request.auth.workspaceId, threadId, force: true })
    if (!suggestion) return reply.code(404).send({ error: 'NOT_FOUND', message: '消息线程不存在或尚无客户回复。' })
    return suggestion
  })

  app.post('/reply-suggestions/:id/approve', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = await db.$first(db.select().from(replySuggestions).where(and(eq(replySuggestions.id, id), eq(replySuggestions.workspaceId, request.auth.workspaceId))))
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '回复建议不存在。' })
    const now = Date.now(); await db.update(replySuggestions).set({ approvedByUserId: request.auth.userId, approvedAt: now, updatedAt: now }).where(eq(replySuggestions.id, id))
    return { id, approvedAt: now }
  })

  app.get('/deals/:id/recommendation', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = await generateSalesRecommendation({ workspaceId: request.auth.workspaceId, dealId: id })
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '商机不存在、已结束或暂无建议。' })
    return recommendationView(row)
  })

  app.post('/deals/:id/recommendation/regenerate', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = await generateSalesRecommendation({ workspaceId: request.auth.workspaceId, dealId: id, force: true })
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '商机不存在或已经结束。' })
    return recommendationView(row)
  })

  app.post('/recommendations/:id/accept', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = await db.$first(db.select().from(salesRecommendations).where(and(eq(salesRecommendations.id, id), eq(salesRecommendations.workspaceId, request.auth.workspaceId))))
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '销售建议不存在。' })
    const deal = await db.$first(db.select().from(deals).where(and(eq(deals.id, row.dealId), eq(deals.workspaceId, request.auth.workspaceId))))
    if (!deal) return reply.code(404).send({ error: 'NOT_FOUND', message: '关联商机不存在。' })
    const now = Date.now(); const taskId = createId('tsk')
    await db.transaction(async tx => {
      await tx.insert(tasks).values({ id: taskId, workspaceId: request.auth.workspaceId, customerId: deal.customerId,
        entityType: 'deal', entityId: deal.id, actionPath: `/pipeline?open=${encodeURIComponent(deal.id)}`,
        title: row.title, priority: row.riskLevel === 'high' ? '高' : '中', dueAt: now + DAY,
        dueLabel: '24 小时内', company: deal.company, nextAction: row.nextAction, impact: row.rationale,
        source: 'AI 销售建议', status: 'open', ownerUserId: deal.ownerUserId, createdAt: now, updatedAt: now })
      await tx.update(salesRecommendations).set({ status: 'accepted', acceptedByUserId: request.auth.userId, acceptedAt: now, updatedAt: now }).where(eq(salesRecommendations.id, id))
    })
    return { id, taskId, actionPath: `/pipeline?open=${encodeURIComponent(deal.id)}` }
  })

  app.get('/runs', async request => {
    await reconcileClosedLoop({ workspaceId: request.auth.workspaceId })
    const rows = await db.select().from(automationRuns).where(eq(automationRuns.workspaceId, request.auth.workspaceId)).orderBy(desc(automationRuns.createdAt)).limit(100)
    return { items: rows.map(runView), total: rows.length }
  })

  app.get('/runs/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = await db.$first(db.select().from(automationRuns).where(and(eq(automationRuns.id, id), eq(automationRuns.workspaceId, request.auth.workspaceId))))
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '自动化运行不存在。' })
    const events = await db.select().from(automationEvents).where(and(eq(automationEvents.runId, id), eq(automationEvents.workspaceId, request.auth.workspaceId))).orderBy(automationEvents.createdAt)
    return { ...runView(row), events: events.map(eventView) }
  })

  app.post('/runs/:id/retry', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const run = await db.$first(db.select().from(automationRuns).where(and(eq(automationRuns.id, id), eq(automationRuns.workspaceId, request.auth.workspaceId))))
    if (!run) return reply.code(404).send({ error: 'NOT_FOUND', message: '自动化运行不存在。' })
    if (!run.traceId.startsWith('radar:')) return reply.code(409).send({ error: 'NOT_RETRYABLE', message: '该运行不支持重试。' })
    const taskId = run.traceId.slice(6); const task = await db.$first(db.select().from(radarTasks).where(and(eq(radarTasks.id, taskId), eq(radarTasks.workspaceId, request.auth.workspaceId))))
    if (!task || task.status !== 'failed') return reply.code(409).send({ error: 'INVALID_TRANSITION', message: '只有失败的获客运行可以重试。' })
    const queue = await db.$first(db.select().from(radarQueueItems).where(eq(radarQueueItems.radarTaskId, taskId)).orderBy(desc(radarQueueItems.createdAt)))
    const now = Date.now()
    await db.transaction(async tx => {
      await tx.update(radarTasks).set({ status: 'queued', currentStage: '等待重试', lastError: null, completedAt: null, updatedAt: now }).where(eq(radarTasks.id, taskId))
      if (queue) await tx.update(radarQueueItems).set({ status: 'queued', lastError: null, completedAt: null, scheduledAt: now, updatedAt: now }).where(eq(radarQueueItems.id, queue.id))
      await tx.update(automationRuns).set({ status: 'running', completedAt: null }).where(eq(automationRuns.id, id))
    })
    return { id, taskId, status: 'queued' }
  })

  app.post('/plans/:id/simulate', async (request, reply) => {
    const planId = (request.params as { id: string }).id
    const plan = await db.$first(db.select().from(acquisitionPlans).where(and(eq(acquisitionPlans.id, planId), eq(acquisitionPlans.workspaceId, request.auth.workspaceId))))
    if (!plan) return reply.code(404).send({ error: 'NOT_FOUND', message: '获客计划不存在。' })
    const safety = await getAutomationSafetyDecision(request.auth.workspaceId); const now = Date.now(); const runId = createId('run'); const traceId = createId('trace')
    const steps = [
      { key: 'discover', status: 'completed', title: '企业发现', description: `将使用 ${parseJson<string[]>(plan.dataSourcesJson, []).join('、') || '默认来源'}，目标地区：${plan.targetRegion}。` },
      { key: 'qualify', status: 'completed', title: '匹配与去重', description: `候选需达到 ${plan.minAutoScore} 分，并通过企业、域名和历史触达去重。` },
      { key: 'verify', status: plan.autoOutreachEnabled ? 'completed' : 'warning', title: '联系人验证', description: plan.autoOutreachEnabled ? '只有已验证且未被抑制的联系人进入触达门槛。' : '当前计划不会自动发送，仅生成可复核客户。' },
      { key: 'promote', status: plan.autoPromoteEnabled ? 'completed' : 'warning', title: '进入客户库', description: plan.autoPromoteEnabled ? '高质量候选将自动保存并创建关联任务。' : '候选需要人工确认后保存。' },
      { key: 'outreach', status: !safety.safe ? 'blocked' : plan.autoOutreachEnabled ? 'completed' : 'warning', title: '安全触达', description: !safety.safe ? safety.reasons.join('；') : plan.autoOutreachEnabled ? '通过发送窗口、频率、退订和回复停止检查后才会进入队列。' : '未启用自动触达，不会发送真实消息。' },
    ]
    const status = steps.some(step => step.status === 'blocked') ? 'blocked' : 'completed'
    await db.transaction(async tx => {
      await tx.insert(automationRuns).values({ id: runId, workspaceId: request.auth.workspaceId, planId, runType: 'simulation', triggerType: 'manual', status,
        traceId, summary: `${plan.name} · 全流程模拟`, inputJson: JSON.stringify({ planId }), resultJson: JSON.stringify({ safe: safety.safe, steps }), startedAt: now, completedAt: now, createdAt: now })
      await tx.insert(automationEvents).values(steps.map(step => ({ id: createId('aev'), workspaceId: request.auth.workspaceId, runId, stepKey: step.key,
        status: step.status, title: step.title, description: step.description, entityType: 'acquisition_plan', entityId: planId,
        actionPath: '/radar', metadataJson: '{}', createdAt: now })))
    })
    return { id: runId, traceId, status, safe: safety.safe, steps }
  })

  app.get('/plans/:id/learning-versions', async (request, reply) => {
    const planId = (request.params as { id: string }).id
    const plan = await db.$first(db.select({ id: acquisitionPlans.id }).from(acquisitionPlans).where(and(eq(acquisitionPlans.id, planId), eq(acquisitionPlans.workspaceId, request.auth.workspaceId))))
    if (!plan) return reply.code(404).send({ error: 'NOT_FOUND', message: '获客计划不存在。' })
    await createLearningSnapshot({ workspaceId: request.auth.workspaceId, planId })
    const rows = await db.select().from(learningSnapshots).where(and(eq(learningSnapshots.workspaceId, request.auth.workspaceId), eq(learningSnapshots.planId, planId))).orderBy(desc(learningSnapshots.version))
    return { items: rows.map(learningView), total: rows.length }
  })

  app.post('/learning-versions/:id/:action', async (request, reply) => {
    const { id, action } = request.params as { id: string; action: string }
    if (!['activate', 'freeze'].includes(action)) return reply.code(400).send({ error: 'INVALID_ACTION', message: '仅支持启用或冻结学习版本。' })
    const row = await db.$first(db.select().from(learningSnapshots).where(and(eq(learningSnapshots.id, id), eq(learningSnapshots.workspaceId, request.auth.workspaceId))))
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '学习版本不存在。' })
    const now = Date.now()
    if (action === 'activate') {
      await db.transaction(async tx => {
        await tx.update(learningSnapshots).set({ status: 'archived' }).where(and(eq(learningSnapshots.planId, row.planId), sql`${learningSnapshots.id} <> ${id}`))
        await tx.update(learningSnapshots).set({ status: 'active', activatedAt: now, frozenAt: null }).where(eq(learningSnapshots.id, id))
      })
    } else await db.update(learningSnapshots).set({ status: 'frozen', frozenAt: now }).where(eq(learningSnapshots.id, id))
    return learningView((await db.$first(db.select().from(learningSnapshots).where(eq(learningSnapshots.id, id))))!)
  })
}

const DAY = 86_400_000
