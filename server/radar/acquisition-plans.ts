import { and, asc, desc, eq, gte, inArray, lte, or } from 'drizzle-orm'
import { getAiReadiness } from '../ai/client.js'
import { db } from '../db/client.js'
import { acquisitionPlans, candidateContacts, candidateEvidence, customers, inboxContacts, radarCandidates, radarQueueItems, radarTasks, tasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { queueAutomatedOutreach } from './auto-outreach.js'
import { assessCandidateGeography, resolveRunTargetRegion } from './market-targeting.js'
import { assessCandidateQualification } from './qualification.js'

export type AcquisitionScheduleType = 'manual' | 'daily' | 'weekdays' | 'weekly'
export type AcquisitionTriggerType = 'manual' | 'scheduled' | 'catch_up'

const safeJson = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T } catch { return fallback }
}

const zonedParts = (timestamp: number, timeZone: string) => {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).reduce<Record<string, number>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value)
    return result
  }, {})
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second }
}

const zonedLocalToUtc = (year: number, month: number, day: number, hour: number, minute: number, timeZone: string) => {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  let guess = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = zonedParts(guess, timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    guess += target - represented
  }
  return guess
}

export const computeNextPlanRunAt = (input: {
  scheduleType: AcquisitionScheduleType
  runTimeLocal: string
  timezone: string
  weekdays?: number[]
  from?: number
}) => {
  if (input.scheduleType === 'manual') return null
  const from = input.from ?? Date.now()
  const [hour = 8, minute = 0] = input.runTimeLocal.split(':').map(Number)
  const local = zonedParts(from, input.timezone)
  const baseDate = new Date(Date.UTC(local.year, local.month - 1, local.day))
  const allowedDays = input.scheduleType === 'daily'
    ? new Set([1, 2, 3, 4, 5, 6, 7])
    : input.scheduleType === 'weekdays'
      ? new Set([1, 2, 3, 4, 5])
      : new Set((input.weekdays?.length ? input.weekdays : [1]).filter(day => day >= 1 && day <= 7))
  for (let offset = 0; offset <= 14; offset += 1) {
    const candidateDate = new Date(baseDate.getTime() + offset * 86_400_000)
    const isoDay = candidateDate.getUTCDay() || 7
    if (!allowedDays.has(isoDay)) continue
    const candidate = zonedLocalToUtc(candidateDate.getUTCFullYear(), candidateDate.getUTCMonth() + 1, candidateDate.getUTCDate(), hour, minute, input.timezone)
    if (candidate > from) return candidate
  }
  return null
}

export const acquisitionPlanView = (plan: typeof acquisitionPlans.$inferSelect) => ({
  ...plan,
  dataSources: safeJson<string[]>(plan.dataSourcesJson, []),
  intentSignals: safeJson<string[]>(plan.intentSignalsJson, []),
  seedUrls: safeJson<string[]>(plan.seedUrlsJson, []),
  weekdays: safeJson<number[]>(plan.weekdaysJson, [1, 2, 3, 4, 5]),
})

export const createPlanRun = async (
  plan: typeof acquisitionPlans.$inferSelect,
  triggerType: AcquisitionTriggerType,
  options: { enforceAiGate?: boolean } = {},
) => {
  if (options.enforceAiGate !== false && plan.requireAi) {
    const readiness = await getAiReadiness(plan.workspaceId)
    if (!readiness.ready) throw new Error(readiness.message)
  }
  const activeRun = await db.$first(db.select({ id: radarTasks.id }).from(radarTasks).where(and(
    eq(radarTasks.workspaceId, plan.workspaceId),
    eq(radarTasks.acquisitionPlanId, plan.id),
    inArray(radarTasks.status, ['queued', 'running', 'paused']),
  )))
  if (activeRun) throw new Error('该获客计划已有运行中的任务，请等待本轮完成。')

  const now = Date.now()
  const runNumber = plan.totalRuns + 1
  const runTargetRegion = resolveRunTargetRegion(plan.targetRegion, runNumber)
  const task = {
    id: createId('rdr'), workspaceId: plan.workspaceId, ownerUserId: plan.ownerUserId,
    acquisitionPlanId: plan.id, runNumber, triggerType,
    name: `${plan.name} · 第 ${runNumber} 轮`, icp: plan.icp, mode: plan.mode, strategy: plan.strategy,
    dataSourcesJson: plan.dataSourcesJson, intentSignalsJson: plan.intentSignalsJson, depth: plan.depth,
    candidateLimit: Math.min(plan.candidateLimit, plan.dailyCandidateLimit), knowledgeScope: plan.knowledgeScope,
    targetRegion: runTargetRegion, researchLanguage: plan.researchLanguage, inputSource: plan.inputSource,
    seedUrlsJson: plan.seedUrlsJson, status: 'queued', progress: 0, currentStage: '等待执行',
    candidatesFound: 0, highMatchCount: 0, lastError: null, startedAt: null, completedAt: null,
    createdAt: now, updatedAt: now,
  }
  const queue = {
    id: createId('job'), workspaceId: plan.workspaceId, radarTaskId: task.id, jobType: 'discover',
    status: 'queued', attempts: 0, maxAttempts: 3, scheduledAt: now, startedAt: null, completedAt: null,
    lastError: null, payload: JSON.stringify(acquisitionPlanView(plan)), createdAt: now, updatedAt: now,
  }
  const nextRunAt = computeNextPlanRunAt({
    scheduleType: plan.scheduleType as AcquisitionScheduleType,
    runTimeLocal: plan.runTimeLocal,
    timezone: plan.timezone,
    weekdays: safeJson(plan.weekdaysJson, [1, 2, 3, 4, 5]),
    from: now,
  })
  await db.transaction(async tx => {
    await tx.insert(radarTasks).values(task)
    await tx.insert(radarQueueItems).values(queue)
    await tx.update(acquisitionPlans).set({
      status: 'active', totalRuns: runNumber, lastRunAt: now, nextRunAt,
      lastError: null, updatedAt: now,
    }).where(eq(acquisitionPlans.id, plan.id))
  })
  return { task, queue }
}

export const dispatchDueAcquisitionPlans = async (now = Date.now()) => {
  const duePlans = await db.select().from(acquisitionPlans).where(and(
    eq(acquisitionPlans.enabled, true),
    or(eq(acquisitionPlans.status, 'active'), eq(acquisitionPlans.status, 'blocked')),
    lte(acquisitionPlans.nextRunAt, now),
  )).orderBy(asc(acquisitionPlans.nextRunAt)).limit(10)
  let dispatched = 0
  for (const plan of duePlans) {
    try {
      await createPlanRun(plan, plan.nextRunAt && plan.nextRunAt < now - 5 * 60_000 ? 'catch_up' : 'scheduled')
      dispatched += 1
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '自动获客计划暂时无法执行。'
      const isBusy = message.includes('运行中的任务')
      await db.update(acquisitionPlans).set({
        status: isBusy ? 'active' : 'blocked',
        lastError: message,
        nextRunAt: isBusy
          ? computeNextPlanRunAt({ scheduleType: plan.scheduleType as AcquisitionScheduleType, runTimeLocal: plan.runTimeLocal, timezone: plan.timezone, weekdays: safeJson(plan.weekdaysJson, []), from: now })
          : now + 15 * 60_000,
        consecutiveFailures: isBusy ? plan.consecutiveFailures : plan.consecutiveFailures + 1,
        updatedAt: now,
      }).where(eq(acquisitionPlans.id, plan.id))
    }
  }
  return dispatched
}

const runSafeAutopilot = async (task: typeof radarTasks.$inferSelect, plan: typeof acquisitionPlans.$inferSelect) => {
  if (!plan.autoPromoteEnabled || plan.automationMode !== 'safe_autopilot') return { promoted: 0, outreachQueued: 0, outreachSkipped: 0 }
  const candidates = await db.select().from(radarCandidates).where(and(
    eq(radarCandidates.workspaceId, task.workspaceId),
    eq(radarCandidates.radarTaskId, task.id),
    gte(radarCandidates.score, plan.minAutoScore),
    inArray(radarCandidates.status, ['candidate', 'review']),
  )).orderBy(desc(radarCandidates.score))
  let promoted = 0
  let outreachQueued = 0
  let outreachSkipped = 0
  for (const candidate of candidates) {
    const [contacts, evidenceRows] = await Promise.all([
      db.select().from(candidateContacts).where(and(eq(candidateContacts.workspaceId, task.workspaceId), eq(candidateContacts.candidateId, candidate.id))).orderBy(desc(candidateContacts.confidence)),
      db.select().from(candidateEvidence).where(and(eq(candidateEvidence.workspaceId, task.workspaceId), eq(candidateEvidence.candidateId, candidate.id))),
    ])
    const candidateView = {
      ...candidate,
      currency: candidate.currency as 'CNY' | 'EUR' | 'USD',
      dimensions: safeJson(candidate.dimensionsJson, []),
      evidence: evidenceRows.filter(item => Boolean(item.sourceUrl)).map(item => ({
        title: item.title, source: item.source, time: item.observedLabel,
        strength: (['强', '中', '弱'].includes(item.strength) ? item.strength : '弱') as '强' | '中' | '弱',
        sourceUrl: item.sourceUrl!,
      })),
      committee: safeJson(candidate.committeeJson, []),
      relationships: safeJson(candidate.relationshipsJson, []),
    }
    const geography = assessCandidateGeography(task, candidateView)
    if (!geography.allowed) { outreachSkipped += 1; continue }
    const qualification = assessCandidateQualification({ icp: task.icp, strategy: task.strategy, targetRegion: task.targetRegion }, geography.candidate)
    if (!qualification.allowed) {
      await db.update(radarCandidates).set({ status: 'review', updatedAt: Date.now() }).where(eq(radarCandidates.id, candidate.id))
      outreachSkipped += 1
      continue
    }
    const bestContact = contacts.find(contact => contact.email && contact.confidence >= 70)
    if (!bestContact || evidenceRows.length < 2 || candidate.confidence < 75) continue
    const now = Date.now()
    let customer = await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, task.workspaceId), eq(customers.company, candidate.company))))
    if (!customer) {
      const created = {
        id: createId('cus'), workspaceId: task.workspaceId, company: candidate.company, region: candidate.region,
        industry: candidate.industry, score: candidate.score, confidence: candidate.confidence, signal: candidate.signal,
        source: `${candidate.source} · 自动准入`, estimatedValue: candidate.estimatedValue, size: candidate.size,
        stage: '重点跟进', contacts: contacts.length, validContacts: contacts.filter(contact => Boolean(contact.email)).length,
        interaction: '刚刚 · 自动获客准入', nextAction: '人工复核后安排首次触达', dueAt: now + 24 * 60 * 60_000,
        archivedAt: null, scoreOverride: null, scoreOverrideReason: null, scoreOverrideByUserId: null,
        scoreOverrideAt: null, ownerUserId: plan.ownerUserId, createdAt: now, updatedAt: now,
      }
      await db.insert(customers).values(created)
      customer = created
      promoted += 1
    }
    const existingContact = await db.$first(db.select({ id: inboxContacts.id }).from(inboxContacts).where(and(
      eq(inboxContacts.workspaceId, task.workspaceId), eq(inboxContacts.company, candidate.company), eq(inboxContacts.name, bestContact.name),
    )))
    if (!existingContact) await db.insert(inboxContacts).values({
      id: createId('ict'), workspaceId: task.workspaceId, customerId: customer.id, name: bestContact.name,
      company: candidate.company, jobTitle: bestContact.role, region: candidate.region, source: 'AI 获客自动准入',
      primaryChannel: '邮件', email: bestContact.email, phone: bestContact.phone, externalRef: null,
      whatsappOptedInAt: null, whatsappOptInSource: null,
      verificationStatus: bestContact.verificationStatus === 'verified' ? 'verified' : 'unverified',
      verifiedAt: bestContact.verificationStatus === 'verified' ? now : null,
      verificationSource: bestContact.verificationStatus === 'verified' ? '公开证据自动核验' : null,
      createdAt: now, updatedAt: now,
    })
    const existingTask = await db.$first(db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, task.workspaceId), eq(tasks.customerId, customer.id), eq(tasks.status, 'open'))))
    if (!existingTask) await db.insert(tasks).values({
      id: createId('tsk'), workspaceId: task.workspaceId, customerId: customer.id, title: plan.autoOutreachEnabled ? '监控自动首触达回复' : '复核 AI 研究并批准首次触达',
      priority: plan.autoOutreachEnabled ? '中' : '高', dueAt: now + (plan.autoOutreachEnabled ? 72 : 24) * 60 * 60_000, dueLabel: plan.autoOutreachEnabled ? '3 天内' : '24 小时内', company: candidate.company,
      nextAction: plan.autoOutreachEnabled ? '等待发送结果与客户回复；异常时人工接管' : '确认联系人、证据和个性化沟通内容', impact: candidate.estimatedValue > 0 ? `${candidate.currency} ${candidate.estimatedValue.toLocaleString()}` : '待评估',
      source: '自动获客', status: 'open', archivedAt: null, ownerUserId: plan.ownerUserId, createdAt: now, updatedAt: now,
    })
    if (plan.autoOutreachEnabled) {
      try {
        const outreach = await queueAutomatedOutreach({ plan, task, candidate, customer, contact: bestContact })
        if (outreach.status === 'queued') outreachQueued += 1
        else outreachSkipped += 1
      } catch {
        outreachSkipped += 1
      }
    }
    await db.update(radarCandidates).set({ status: 'saved', updatedAt: now }).where(eq(radarCandidates.id, candidate.id))
  }
  return { promoted, outreachQueued, outreachSkipped }
}

export const updatePlanAfterRun = async (task: typeof radarTasks.$inferSelect, success: boolean, error?: string) => {
  if (!task.acquisitionPlanId) return { promoted: 0, outreachQueued: 0, outreachSkipped: 0 }
  const plan = await db.$first(db.select().from(acquisitionPlans).where(eq(acquisitionPlans.id, task.acquisitionPlanId)))
  if (!plan) return { promoted: 0, outreachQueued: 0, outreachSkipped: 0 }
  const now = Date.now()
  let promoted = 0
  let outreachQueued = 0
  let outreachSkipped = 0
  let automationError: string | null = null
  if (success) {
    try {
      const automation = await runSafeAutopilot(task, plan)
      promoted = automation.promoted
      outreachQueued = automation.outreachQueued
      outreachSkipped = automation.outreachSkipped
    }
    catch (cause) { automationError = cause instanceof Error ? cause.message : '自动准入未完成。' }
  }
  await db.update(acquisitionPlans).set(success ? {
    status: plan.enabled ? 'active' : 'paused', lastSuccessAt: now, lastError: automationError,
    consecutiveFailures: 0, updatedAt: now,
  } : {
    status: plan.enabled ? 'blocked' : 'paused', lastError: error ?? '本轮获客执行失败。',
    consecutiveFailures: plan.consecutiveFailures + 1,
    nextRunAt: plan.enabled ? Math.min(plan.nextRunAt ?? Number.MAX_SAFE_INTEGER, now + 30 * 60_000) : null,
    updatedAt: now,
  }).where(eq(acquisitionPlans.id, plan.id))
  return { promoted, outreachQueued, outreachSkipped, error: automationError }
}
