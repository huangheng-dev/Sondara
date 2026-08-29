import { and, desc, eq, gte, inArray, isNull, like, lt, sql } from 'drizzle-orm'
import { completeWithAi } from '../ai/client.js'
import { db } from '../db/client.js'
import {
  acquisitionPlans, automationEvents, automationRuns, customerOutcomes, deals, learningSnapshots,
  messageEntries, messageThreads, radarCandidates, radarJobEvents, radarTasks, replySuggestions, salesRecommendations,
  tasks, workspaceNotifications,
} from '../db/schema.js'
import { generateReplySuggestion } from '../inbox/reply-assistant.js'
import { createId } from '../lib/ids.js'
import { getAcquisitionFeedbackLearning } from '../radar/feedback-learning.js'

const DAY = 86_400_000

const json = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T } catch { return fallback }
}

export const replySuggestionView = (row: typeof replySuggestions.$inferSelect) => ({
  id: row.id,
  inboundMessageId: row.inboundMessageId,
  version: row.version,
  status: row.status,
  source: row.source,
  draft: row.draft,
  rationale: row.rationale,
  nextAction: row.nextAction,
  missingInformation: json<string[]>(row.missingInformationJson, []),
  warnings: json<string[]>(row.warningsJson, []),
  language: row.language,
  confidence: row.confidence,
  requiresHumanConfirmation: true as const,
  generatedAt: row.createdAt,
  model: row.modelLabel ?? undefined,
  approvedAt: row.approvedAt,
})

export const createNotification = async (input: {
  workspaceId: string
  userId?: string | null
  notificationType: string
  tone?: 'info' | 'success' | 'warning' | 'error'
  title: string
  description?: string
  entityType?: string | null
  entityId?: string | null
  actionPath?: string | null
  dedupeKey: string
}) => {
  const now = Date.now()
  await db.insert(workspaceNotifications).values({
    id: createId('not'), workspaceId: input.workspaceId, userId: input.userId ?? null,
    notificationType: input.notificationType, tone: input.tone ?? 'info', title: input.title,
    description: input.description ?? '', entityType: input.entityType ?? null, entityId: input.entityId ?? null,
    actionPath: input.actionPath ?? null, dedupeKey: input.dedupeKey, readAt: null, createdAt: now, updatedAt: now,
  }).onConflictDoNothing()
}

export const persistReplySuggestion = async (input: { workspaceId: string; threadId: string; force?: boolean }) => {
  const inbound = await db.$first(db.select().from(messageEntries).where(and(
    eq(messageEntries.workspaceId, input.workspaceId), eq(messageEntries.threadId, input.threadId), eq(messageEntries.direction, 'inbound'),
  )).orderBy(desc(messageEntries.createdAt)))
  if (!inbound) return null
  const existing = await db.$first(db.select().from(replySuggestions).where(and(
    eq(replySuggestions.workspaceId, input.workspaceId), eq(replySuggestions.inboundMessageId, inbound.id), isNull(replySuggestions.supersededAt),
  )).orderBy(desc(replySuggestions.version)))
  if (existing && !input.force) return replySuggestionView(existing)
  const generated = await generateReplySuggestion({ workspaceId: input.workspaceId, threadId: input.threadId })
  if (!generated) return null
  // Reply generation may call an external model. The message can be removed while
  // that request is in flight (for example during workspace deletion or test
  // teardown), so verify the foreign-key target still exists before persisting.
  const inboundStillExists = await db.$first(db.select({ id: messageEntries.id }).from(messageEntries).where(and(
    eq(messageEntries.workspaceId, input.workspaceId), eq(messageEntries.id, inbound.id),
  )))
  if (!inboundStillExists) return null
  const now = Date.now()
  const version = (existing?.version ?? 0) + 1
  if (existing) await db.update(replySuggestions).set({ supersededAt: now, updatedAt: now }).where(eq(replySuggestions.id, existing.id))
  const id = createId('rsg')
  await db.insert(replySuggestions).values({
    id, workspaceId: input.workspaceId, threadId: input.threadId, inboundMessageId: inbound.id, version,
    status: generated.status, source: generated.source, draft: generated.draft, rationale: generated.rationale,
    nextAction: generated.nextAction, missingInformationJson: JSON.stringify(generated.missingInformation),
    warningsJson: JSON.stringify(generated.warnings), language: generated.language, confidence: generated.confidence,
    modelLabel: generated.model ?? null, createdAt: now, updatedAt: now,
  })
  const row = (await db.$first(db.select().from(replySuggestions).where(eq(replySuggestions.id, id))))!
  if (generated.status !== 'blocked') await createNotification({
    workspaceId: input.workspaceId, notificationType: 'reply_suggestion', tone: generated.status === 'ready' ? 'success' : 'info',
    title: '客户回复建议已准备', description: generated.nextAction, entityType: 'message_thread', entityId: input.threadId,
    actionPath: `/inbox?thread=${encodeURIComponent(input.threadId)}`, dedupeKey: `reply-suggestion:${inbound.id}:${version}`,
  })
  return replySuggestionView(row)
}

const ruleRecommendation = (deal: typeof deals.$inferSelect) => {
  const age = Math.max(0, Math.floor((Date.now() - deal.stageEnteredAt) / DAY))
  const stageMap: Record<string, { title: string; next: string; missing: string[] }> = {
    线索确认: { title: '确认真实需求与决策链', next: '确认应用场景、预算、时间窗口和参与决策的角色', missing: ['应用场景', '预算范围', '采购时间', '决策角色'] },
    需求确认: { title: '形成可验证的需求清单', next: '把技术参数、数量、认证与交付要求整理成双方确认的清单', missing: ['关键参数', '数量', '认证要求', '交付地点'] },
    方案评估: { title: '推动方案验证', next: '安排样品、技术澄清或方案评审，并约定明确反馈日期', missing: ['验证标准', '评审人', '反馈日期'] },
    商务谈判: { title: '收敛商务条件', next: '确认价格、付款、交期、合同主体和最终审批节点', missing: ['付款条件', '目标交期', '最终审批人'] },
  }
  const rule = stageMap[deal.stage] ?? { title: '复核商机状态', next: deal.nextAction, missing: [] }
  return { ...rule, rationale: `${deal.stage}已停留 ${age} 天；当前风险：${deal.risk || '暂无明确风险'}。`, suggestedStage: null as string | null, riskLevel: age >= 10 ? 'high' : age >= 5 ? 'medium' : 'low', source: 'rule' }
}

export const generateSalesRecommendation = async (input: { workspaceId: string; dealId: string; force?: boolean }) => {
  const deal = await db.$first(db.select().from(deals).where(and(eq(deals.workspaceId, input.workspaceId), eq(deals.id, input.dealId))))
  if (!deal || ['赢单', '输单'].includes(deal.stage)) return null
  const existing = await db.$first(db.select().from(salesRecommendations).where(and(
    eq(salesRecommendations.workspaceId, input.workspaceId), eq(salesRecommendations.dealId, deal.id), eq(salesRecommendations.status, 'active'),
  )).orderBy(desc(salesRecommendations.createdAt)))
  if (existing && !input.force) return existing
  if (existing) await db.update(salesRecommendations).set({ status: 'superseded', updatedAt: Date.now() }).where(eq(salesRecommendations.id, existing.id))
  const fallback = ruleRecommendation(deal)
  let recommendation = fallback
  try {
    const completion = await completeWithAi({ workspaceId: input.workspaceId, timeoutMs: 12_000, maxTokens: 450, temperature: 0.1, messages: [
      { role: 'system', content: 'You are a cautious B2B sales copilot. Return strict JSON only: {"title":"Chinese title","rationale":"Chinese explanation grounded only in supplied facts","nextAction":"specific human-review action","suggestedStage":null,"missingInformation":["..."],"riskLevel":"low|medium|high"}. Never change stage, price, contract or send anything. Recommendations require human approval.' },
      { role: 'user', content: JSON.stringify({ company: deal.company, stage: deal.stage, probability: deal.probability, value: deal.valueAmount, currency: deal.currency, nextAction: deal.nextAction, risk: deal.risk, expectedCloseAt: deal.expectedCloseAt }) },
    ] })
    const start = completion.content.indexOf('{'); const end = completion.content.lastIndexOf('}')
    const parsed = JSON.parse(completion.content.slice(start, end + 1)) as Record<string, unknown>
    recommendation = {
      title: String(parsed.title || fallback.title).slice(0, 160), rationale: String(parsed.rationale || fallback.rationale).slice(0, 800),
      next: String(parsed.nextAction || fallback.next).slice(0, 300), missing: Array.isArray(parsed.missingInformation) ? parsed.missingInformation.map(String).slice(0, 8) : fallback.missing,
      suggestedStage: typeof parsed.suggestedStage === 'string' ? parsed.suggestedStage : null,
      riskLevel: ['low', 'medium', 'high'].includes(String(parsed.riskLevel)) ? String(parsed.riskLevel) : fallback.riskLevel, source: 'ai',
    }
  } catch { /* safe rule fallback */ }
  const now = Date.now(); const id = createId('rec')
  await db.insert(salesRecommendations).values({
    id, workspaceId: input.workspaceId, dealId: deal.id, status: 'active', title: recommendation.title,
    rationale: recommendation.rationale, nextAction: recommendation.next, suggestedStage: recommendation.suggestedStage,
    missingInformationJson: JSON.stringify(recommendation.missing), riskLevel: recommendation.riskLevel,
    source: recommendation.source, createdAt: now, updatedAt: now,
  })
  return (await db.$first(db.select().from(salesRecommendations).where(eq(salesRecommendations.id, id))))!
}

export const createLearningSnapshot = async (input: { workspaceId: string; planId: string; activate?: boolean }) => {
  const model = await getAcquisitionFeedbackLearning({ workspaceId: input.workspaceId, planId: input.planId, days: 90, useSnapshot: false })
  if (!model) return null
  const latest = await db.$first(db.select().from(learningSnapshots).where(and(
    eq(learningSnapshots.workspaceId, input.workspaceId), eq(learningSnapshots.planId, input.planId),
  )).orderBy(desc(learningSnapshots.version)))
  if (latest?.sampleCount === model.labeledOutcomes && latest.positiveRate === Math.round(model.basePositiveRate * 10)) return latest
  const frozen = await db.$first(db.select({ id: learningSnapshots.id }).from(learningSnapshots).where(and(
    eq(learningSnapshots.workspaceId, input.workspaceId), eq(learningSnapshots.planId, input.planId), eq(learningSnapshots.status, 'frozen'),
  )))
  const now = Date.now(); const version = (latest?.version ?? 0) + 1; const activate = input.activate ?? (!frozen && model.status === 'active')
  if (activate) await db.update(learningSnapshots).set({ status: 'archived' }).where(and(
    eq(learningSnapshots.workspaceId, input.workspaceId), eq(learningSnapshots.planId, input.planId), eq(learningSnapshots.status, 'active'),
  ))
  const id = createId('lrn')
  await db.insert(learningSnapshots).values({
    id, workspaceId: input.workspaceId, planId: input.planId, version, status: activate ? 'active' : 'candidate',
    sampleCount: model.labeledOutcomes, positiveRate: Math.round(model.basePositiveRate * 10), modelJson: JSON.stringify(model),
    activatedAt: activate ? now : null, createdAt: now,
  })
  return (await db.$first(db.select().from(learningSnapshots).where(eq(learningSnapshots.id, id))))!
}

const syncAutomationRuns = async (workspaceId?: string) => {
  const taskRows = await db.select().from(radarTasks).orderBy(desc(radarTasks.createdAt)).limit(150)
  for (const task of workspaceId ? taskRows.filter(row => row.workspaceId === workspaceId) : taskRows) {
    const traceId = `radar:${task.id}`
    let run = await db.$first(db.select().from(automationRuns).where(eq(automationRuns.traceId, traceId)))
    const status = task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'failed' : task.status === 'cancelled' ? 'cancelled' : 'running'
    if (!run) {
      const id = createId('run')
      await db.insert(automationRuns).values({
        id, workspaceId: task.workspaceId, planId: task.acquisitionPlanId, runType: 'live', triggerType: task.triggerType,
        status, traceId, summary: task.name, inputJson: JSON.stringify({ taskId: task.id, icp: task.icp, region: task.targetRegion }),
        resultJson: JSON.stringify({ candidates: task.candidatesFound, highMatch: task.highMatchCount, error: task.lastError }),
        startedAt: task.startedAt ?? task.createdAt, completedAt: task.completedAt, createdAt: task.createdAt,
      })
      run = (await db.$first(db.select().from(automationRuns).where(eq(automationRuns.id, id))))!
    } else {
      await db.update(automationRuns).set({ status, resultJson: JSON.stringify({ candidates: task.candidatesFound, highMatch: task.highMatchCount, error: task.lastError }), completedAt: task.completedAt }).where(eq(automationRuns.id, run.id))
    }
    const events = await db.select().from(radarJobEvents).where(eq(radarJobEvents.radarTaskId, task.id)).orderBy(radarJobEvents.createdAt)
    const existing = await db.select({ stepKey: automationEvents.stepKey }).from(automationEvents).where(eq(automationEvents.runId, run.id))
    const keys = new Set(existing.map(item => item.stepKey))
    for (const event of events) if (!keys.has(event.id)) await db.insert(automationEvents).values({
      id: createId('aev'), workspaceId: task.workspaceId, runId: run.id, stepKey: event.id,
      status: event.level === 'error' ? 'failed' : event.level === 'warning' ? 'warning' : 'completed', title: event.eventType,
      description: event.message, entityType: 'radar_task', entityId: task.id, actionPath: `/radar?run=${encodeURIComponent(task.id)}`,
      metadataJson: event.metadata, createdAt: event.createdAt,
    })
    const [candidates, outbound] = await Promise.all([
      db.select().from(radarCandidates).where(and(eq(radarCandidates.workspaceId, task.workspaceId), eq(radarCandidates.radarTaskId, task.id))),
      db.select().from(messageEntries).where(and(eq(messageEntries.workspaceId, task.workspaceId), eq(messageEntries.direction, 'outbound'), like(messageEntries.metadataJson, `%"radarTaskId":"${task.id}"%`))),
    ])
    const appendSummary = async (stepKey: string, statusValue: string, title: string, description: string, actionPath: string) => {
      if (keys.has(stepKey)) return
      keys.add(stepKey)
      await db.insert(automationEvents).values({ id: createId('aev'), workspaceId: task.workspaceId, runId: run!.id, stepKey,
        status: statusValue, title, description, entityType: 'radar_task', entityId: task.id, actionPath, metadataJson: '{}', createdAt: Date.now() })
    }
    if (candidates.length) await appendSummary(`${task.id}:candidates`, 'completed', '候选企业形成', `发现 ${candidates.length} 家可核验候选，其中 ${candidates.filter(item => item.status === 'saved').length} 家进入客户库。`, '/radar')
    if (outbound.length) await appendSummary(`${task.id}:outreach`, outbound.some(item => item.status === 'failed') ? 'warning' : 'completed', '触达进入队列', `${outbound.length} 条消息经过验证、抑制和安全发送门槛。`, '/inbox')
    const threadIds = [...new Set(outbound.map(item => item.threadId))]
    const relatedThreads = threadIds.length ? await db.select().from(messageThreads).where(inArray(messageThreads.id, threadIds)) : []
    const replied = relatedThreads.filter(item => item.lastInboundAt)
    if (replied.length) await appendSummary(`${task.id}:replies`, 'completed', '客户回复与意向识别', `收到 ${replied.length} 条客户回复，其中 ${replied.filter(item => item.intent === '高意向').length} 条为高意向。`, '/inbox')
    const customerIds = replied.map(item => item.customerId).filter((value): value is string => Boolean(value))
    const relatedDeals = customerIds.length ? await db.select().from(deals).where(and(eq(deals.workspaceId, task.workspaceId), inArray(deals.customerId, customerIds))) : []
    if (relatedDeals.length) await appendSummary(`${task.id}:deals`, 'completed', '形成销售商机', `已形成 ${relatedDeals.length} 个商机，结果会继续反馈到客户画像学习。`, '/pipeline')
  }
}

export const reconcileClosedLoop = async (options: { workspaceId?: string; now?: number } = {}) => {
  const now = options.now ?? Date.now(); const since = now - 7 * DAY
  const inboundRows = await db.select({ workspaceId: messageEntries.workspaceId, threadId: messageEntries.threadId }).from(messageEntries).where(and(
    eq(messageEntries.direction, 'inbound'), gte(messageEntries.createdAt, since),
  )).orderBy(desc(messageEntries.createdAt)).limit(100)
  let suggestions = 0; let notifications = 0; let recommendations = 0
  for (const row of inboundRows.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) {
    const before = await db.$first(db.select({ id: replySuggestions.id }).from(replySuggestions).where(and(eq(replySuggestions.workspaceId, row.workspaceId), eq(replySuggestions.threadId, row.threadId))))
    if (!before && await persistReplySuggestion({ workspaceId: row.workspaceId, threadId: row.threadId })) suggestions += 1
  }
  const highIntent = await db.select().from(messageThreads).where(and(eq(messageThreads.intent, '高意向'), eq(messageThreads.status, 'open'), gte(messageThreads.updatedAt, since))).limit(100)
  for (const thread of highIntent.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) {
    await createNotification({ workspaceId: thread.workspaceId, notificationType: 'high_intent', tone: 'warning', title: '高意向客户需要接管',
      description: thread.lastMessagePreview, entityType: 'message_thread', entityId: thread.id, actionPath: `/inbox?thread=${encodeURIComponent(thread.id)}`,
      dedupeKey: `high-intent:${thread.id}:${thread.lastInboundAt ?? thread.updatedAt}` })
    notifications += 1
  }
  const overdue = await db.select().from(tasks).where(and(eq(tasks.status, 'open'), isNull(tasks.archivedAt), lt(tasks.dueAt, now))).limit(100)
  for (const task of overdue.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) {
    await createNotification({ workspaceId: task.workspaceId, userId: task.ownerUserId, notificationType: 'overdue_task', tone: 'warning', title: `任务已逾期 · ${task.company}`,
      description: task.nextAction, entityType: task.entityType ?? 'task', entityId: task.entityId ?? task.id,
      actionPath: task.actionPath ?? '/dashboard', dedupeKey: `overdue:${task.id}:${task.dueAt}` })
    notifications += 1
  }
  const failedRuns = await db.select().from(radarTasks).where(and(eq(radarTasks.status, 'failed'), gte(radarTasks.updatedAt, since))).limit(100)
  for (const task of failedRuns.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) {
    await createNotification({ workspaceId: task.workspaceId, userId: task.ownerUserId, notificationType: 'automation_failed', tone: 'error',
      title: `自动获客运行失败 · ${task.name}`, description: task.lastError ?? '请查看运行链路并重试失败节点。',
      entityType: 'radar_task', entityId: task.id, actionPath: `/radar?run=${encodeURIComponent(task.id)}`,
      dedupeKey: `radar-failed:${task.id}:${task.updatedAt}` })
    notifications += 1
  }
  const openDeals = await db.select().from(deals).where(and(isNull(deals.archivedAt), sql`${deals.stage} not in ('赢单','输单')`)).limit(200)
  for (const deal of openDeals.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) {
    const current = await db.$first(db.select({ id: salesRecommendations.id }).from(salesRecommendations).where(and(eq(salesRecommendations.dealId, deal.id), eq(salesRecommendations.status, 'active'))))
    if (!current && await generateSalesRecommendation({ workspaceId: deal.workspaceId, dealId: deal.id })) recommendations += 1
  }
  const plans = await db.select({ id: acquisitionPlans.id, workspaceId: acquisitionPlans.workspaceId }).from(acquisitionPlans).limit(200)
  for (const plan of plans.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) await createLearningSnapshot({ workspaceId: plan.workspaceId, planId: plan.id })
  const blockedPlans = await db.select().from(acquisitionPlans).where(eq(acquisitionPlans.status, 'blocked')).limit(100)
  for (const plan of blockedPlans.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) {
    await createNotification({ workspaceId: plan.workspaceId, userId: plan.ownerUserId, notificationType: 'automation_blocked', tone: 'warning',
      title: `自动获客已暂停 · ${plan.name}`, description: plan.lastError ?? '安全检查未通过，等待恢复。', entityType: 'acquisition_plan',
      entityId: plan.id, actionPath: '/radar', dedupeKey: `plan-blocked:${plan.id}:${plan.updatedAt}` })
    notifications += 1
  }
  const circuitPlans = await db.select().from(acquisitionPlans).where(like(acquisitionPlans.lastError, '%熔断%')).limit(100)
  for (const plan of circuitPlans.filter(item => !options.workspaceId || item.workspaceId === options.workspaceId)) {
    await createNotification({ workspaceId: plan.workspaceId, userId: plan.ownerUserId, notificationType: 'circuit_breaker', tone: 'error',
      title: `自动触达安全熔断 · ${plan.name}`, description: plan.lastError ?? '发送健康指标超过安全阈值。', entityType: 'acquisition_plan',
      entityId: plan.id, actionPath: '/radar', dedupeKey: `circuit-breaker:${plan.id}:${plan.updatedAt}` })
    notifications += 1
  }
  await syncAutomationRuns(options.workspaceId)
  await db.update(tasks).set({ entityType: 'customer', entityId: tasks.customerId, actionPath: sql`'/customers?open=' || ${tasks.customerId}` }).where(and(isNull(tasks.entityType), sql`${tasks.customerId} is not null`))
  return { suggestions, notifications, recommendations }
}

export const recordOutcome = async (input: {
  workspaceId: string; actorUserId?: string | null; customerId?: string | null; dealId?: string | null; threadId?: string | null
  outcome: string; reasonCode?: string | null; note?: string; source?: string; occurredAt?: number
}) => {
  const id = createId('out'); const now = Date.now()
  await db.insert(customerOutcomes).values({ id, workspaceId: input.workspaceId, customerId: input.customerId ?? null, dealId: input.dealId ?? null,
    threadId: input.threadId ?? null, outcome: input.outcome, reasonCode: input.reasonCode ?? null, note: input.note ?? '', source: input.source ?? 'manual',
    actorUserId: input.actorUserId ?? null, occurredAt: input.occurredAt ?? now, createdAt: now })
  return (await db.$first(db.select().from(customerOutcomes).where(eq(customerOutcomes.id, id))))!
}
