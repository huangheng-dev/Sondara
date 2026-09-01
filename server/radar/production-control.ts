import { resolveTxt } from 'node:dns/promises'
import { and, eq, gte, inArray, like, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  acquisitionPlans,
  deals,
  messageDeliveryEvents,
  messageEntries,
  messageThreads,
  outboundChannelConnections,
  outboxJobs,
  radarCandidates,
  tasks,
} from '../db/schema.js'
import { cancelPendingAutomatedMessages } from '../outbox/automation-stop.js'

const DAY = 86_400_000
const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1_000) / 10 : 0
const metadata = (value: string) => {
  try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
}

const autoMessagesSince = async (workspaceId: string, since: number) => (await db.select({
  id: messageEntries.id,
  threadId: messageEntries.threadId,
  status: messageEntries.status,
  metadataJson: messageEntries.metadataJson,
  createdAt: messageEntries.createdAt,
}).from(messageEntries).where(and(
  eq(messageEntries.workspaceId, workspaceId),
  eq(messageEntries.direction, 'outbound'),
  gte(messageEntries.createdAt, since),
  like(messageEntries.metadataJson, '%"automationApprovedByPlan":true%'),
)))

export const getAutomationDeliveryHealth = async (workspaceId: string, days = 7) => {
  const since = Date.now() - days * DAY
  const messages = await autoMessagesSince(workspaceId, since)
  const messageIds = messages.map(message => message.id)
  const [events, jobs] = messageIds.length ? await Promise.all([
    db.select({ eventType: messageDeliveryEvents.eventType }).from(messageDeliveryEvents).where(and(
      eq(messageDeliveryEvents.workspaceId, workspaceId), inArray(messageDeliveryEvents.messageId, messageIds), gte(messageDeliveryEvents.createdAt, since),
    )),
    db.select({ status: outboxJobs.status }).from(outboxJobs).where(and(
      eq(outboxJobs.workspaceId, workspaceId), inArray(outboxJobs.messageId, messageIds), gte(outboxJobs.createdAt, since),
    )),
  ]) : [[], []]
  const countEvent = (name: string) => events.filter(event => event.eventType === name).length
  const sent = messages.filter(message => ['sent', 'delivered', 'failed'].includes(message.status)).length
  const delivered = messages.filter(message => message.status === 'delivered').length
  const bounced = countEvent('bounced')
  const complained = countEvent('complained')
  const unsubscribed = countEvent('unsubscribed')
  const failed = jobs.filter(job => job.status === 'failed').length
  return {
    periodDays: days,
    sent,
    delivered,
    bounced,
    complained,
    unsubscribed,
    failed,
    deliveryRate: percent(delivered, sent),
    bounceRate: percent(bounced, sent),
    complaintRate: percent(complained, sent),
    unsubscribeRate: percent(unsubscribed, sent),
    failureRate: percent(failed, sent + failed),
  }
}

export const getAutomationSafetyDecision = async (workspaceId: string) => {
  const health = await getAutomationDeliveryHealth(workspaceId, 7)
  const reasons: string[] = []
  if (health.complained > 0) reasons.push(`近 7 天出现 ${health.complained} 次投诉`)
  if (health.sent >= 20 && health.bounceRate > 5) reasons.push(`退信率 ${health.bounceRate}% 超过 5%`)
  if (health.sent >= 20 && health.unsubscribeRate > 5) reasons.push(`退订率 ${health.unsubscribeRate}% 超过 5%`)
  if (health.sent >= 20 && health.failureRate > 15) reasons.push(`发送失败率 ${health.failureRate}% 超过 15%`)
  return { safe: reasons.length === 0, reasons, health }
}

export const enforceAutomationCircuitBreaker = async (workspaceId: string) => {
  const decision = await getAutomationSafetyDecision(workspaceId)
  if (decision.safe) return { ...decision, pausedPlans: 0, cancelledMessages: 0 }
  const now = Date.now()
  const reason = `自动触达已熔断：${decision.reasons.join('；')}`
  const activePlans = await db.select({ id: acquisitionPlans.id }).from(acquisitionPlans).where(and(
    eq(acquisitionPlans.workspaceId, workspaceId), eq(acquisitionPlans.autoOutreachEnabled, true), eq(acquisitionPlans.enabled, true),
  ))
  if (activePlans.length) await db.update(acquisitionPlans).set({
    enabled: false, status: 'paused', nextRunAt: null, lastError: reason, updatedAt: now,
  }).where(and(eq(acquisitionPlans.workspaceId, workspaceId), eq(acquisitionPlans.autoOutreachEnabled, true), eq(acquisitionPlans.enabled, true)))
  const cancelledMessages = await cancelPendingAutomatedMessages({ workspaceId, reason })
  return { ...decision, pausedPlans: activePlans.length, cancelledMessages }
}

export const getAutomationRamp = async (input: { workspaceId: string; planId: string; configuredLimit: number; now?: number }) => {
  const now = input.now ?? Date.now()
  const rows = await db.select({ createdAt: messageEntries.createdAt }).from(messageEntries).where(and(
    eq(messageEntries.workspaceId, input.workspaceId),
    eq(messageEntries.direction, 'outbound'),
    like(messageEntries.metadataJson, `%"acquisitionPlanId":"${input.planId}"%`),
    like(messageEntries.metadataJson, '%"outreachStep":0%'),
  ))
  const firstAt = rows.length ? Math.min(...rows.map(row => row.createdAt)) : now
  const ageDays = Math.max(0, Math.floor((now - firstAt) / DAY))
  const rampLimit = ageDays < 1 ? 5 : ageDays < 3 ? 8 : ageDays < 7 ? 12 : 20
  const limit = Math.max(1, Math.min(20, input.configuredLimit, rampLimit))
  const todayStart = now - 24 * 60 * 60_000
  const used = rows.filter(row => row.createdAt >= todayStart).length
  return { limit, used, remaining: Math.max(0, limit - used), stage: ageDays < 1 ? '试运行' : ageDays < 3 ? '低速放量' : ageDays < 7 ? '稳定放量' : '正常运行', ageDays }
}

const txtContains = async (name: string, prefix: string) => {
  try {
    const records = await Promise.race([
      resolveTxt(name),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('DNS timeout')), 2_500)),
    ])
    return records.some(parts => parts.join('').toUpperCase().startsWith(prefix.toUpperCase()))
  } catch { return false }
}

const domainAuthCache = new Map<string, { expiresAt: number; value: { domain: string; spf: boolean; dmarc: boolean; dkim: 'provider_check_required' } }>()
const domainAuthentication = async (domain: string) => {
  const cached = domainAuthCache.get(domain)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const [spf, dmarc] = await Promise.all([txtContains(domain, 'v=spf1'), txtContains(`_dmarc.${domain}`, 'v=DMARC1')])
  const value = { domain, spf, dmarc, dkim: 'provider_check_required' as const }
  domainAuthCache.set(domain, { expiresAt: Date.now() + 15 * 60_000, value })
  return value
}

export const getAutomationProductionControl = async (workspaceId: string) => {
  const now = Date.now()
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const sinceToday = today.getTime()
  const [plans, connections, safety, todayMessages, candidateSummary, todayDeals, humanTasks] = await Promise.all([
    db.select().from(acquisitionPlans).where(and(
      eq(acquisitionPlans.workspaceId, workspaceId), eq(acquisitionPlans.autoOutreachEnabled, true), inArray(acquisitionPlans.status, ['active', 'paused', 'blocked']),
    )),
    db.select().from(outboundChannelConnections).where(and(eq(outboundChannelConnections.workspaceId, workspaceId), eq(outboundChannelConnections.enabled, true))),
    getAutomationSafetyDecision(workspaceId),
    autoMessagesSince(workspaceId, sinceToday),
    db.$first(db.select({
      discovered: sql<number>`count(*)`,
      promoted: sql<number>`sum(case when ${radarCandidates.status} = 'saved' then 1 else 0 end)`,
    }).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, workspaceId), gte(radarCandidates.discoveredAt, sinceToday)))),
    db.$first(db.select({ count: sql<number>`count(*)` }).from(deals).where(and(
      eq(deals.workspaceId, workspaceId), eq(deals.source, '客户高意向回复'), gte(deals.createdAt, sinceToday),
    ))),
    db.$first(db.select({ count: sql<number>`count(*)` }).from(tasks).where(and(
      eq(tasks.workspaceId, workspaceId), eq(tasks.source, 'AI 回复识别'), eq(tasks.status, 'open'),
    ))),
  ])
  const emailProviders = new Set(['smtp', 'sendgrid', 'mailgun'])
  const emailConnections = connections.filter(connection => emailProviders.has(connection.provider))
  const whatsappConnections = connections.filter(connection => connection.provider === 'whatsapp-cloud')
  const domains = [...new Set(emailConnections.map(connection => connection.fromEmail.split('@')[1]?.toLowerCase()).filter((value): value is string => Boolean(value)))]
  const domainAuth = await Promise.all(domains.map(domainAuthentication))
  const healthyConnections = emailConnections.filter(connection => connection.status === 'available')
  const inboundConnections = healthyConnections.filter(connection => connection.imapEnabled && connection.imapHost && connection.imapSecretCiphertext)
  const healthyWhatsappConnections = whatsappConnections.filter(connection => connection.status === 'available')
  const automatedConnections = [...emailConnections, ...whatsappConnections]
  const healthyAutomatedConnections = [...healthyConnections, ...healthyWhatsappConnections]
  const inboundReadyCount = inboundConnections.length + healthyWhatsappConnections.length
  const issues: Array<{ level: 'warning' | 'error'; title: string; description: string; actionPath?: string }> = []
  if (!healthyAutomatedConnections.length) issues.push({ level: 'error', title: '没有可用的自动发送服务', description: '请至少配置并测试一个邮件服务，或配置已通过测试的 WhatsApp Cloud API。', actionPath: '/settings/integrations' })
  if (healthyConnections.length && !inboundConnections.length && !healthyWhatsappConnections.length) issues.push({ level: 'error', title: '客户回复接收尚未就绪', description: '邮件自动触达需要至少启用一个 IMAP 收件连接，系统才能及时停止跟进并识别客户意向。', actionPath: '/settings/integrations' })
  if (domainAuth.some(item => !item.spf)) issues.push({ level: 'warning', title: '部分发件域名未检测到 SPF', description: '请在域名 DNS 中确认发件服务已被 SPF 授权。', actionPath: '/settings/integrations' })
  if (domainAuth.some(item => !item.dmarc)) issues.push({ level: 'warning', title: '部分发件域名未检测到 DMARC', description: '建议先使用监控策略，再逐步提高 DMARC 执行强度。', actionPath: '/settings/integrations' })
  safety.reasons.forEach(reason => issues.push({ level: 'error', title: '触达安全阈值已触发', description: reason }))
  const activePlans = plans.filter(plan => plan.enabled && plan.status === 'active')
  const ramps = await Promise.all(plans.map(async plan => ({ planId: plan.id, planName: plan.name, ...(await getAutomationRamp({ workspaceId, planId: plan.id, configuredLimit: plan.dailyCandidateLimit, now })) })))
  const threadIds = [...new Set(todayMessages.map(message => message.threadId))]
  const threads = threadIds.length ? await db.select({ id: messageThreads.id, lastInboundAt: messageThreads.lastInboundAt, intent: messageThreads.intent }).from(messageThreads).where(and(
    eq(messageThreads.workspaceId, workspaceId), inArray(messageThreads.id, threadIds), gte(messageThreads.lastInboundAt, sinceToday),
  )) : []
  const pendingRows = await db.select({ status: outboxJobs.status, scheduledAt: outboxJobs.scheduledAt, metadataJson: messageEntries.metadataJson }).from(outboxJobs)
    .innerJoin(messageEntries, eq(messageEntries.id, outboxJobs.messageId)).where(and(
      eq(outboxJobs.workspaceId, workspaceId), inArray(outboxJobs.status, ['queued', 'awaiting_configuration']), eq(messageEntries.status, 'confirmed'),
    ))
  const pending = pendingRows.filter(row => metadata(row.metadataJson).automationApprovedByPlan === true)
  return {
    state: !plans.length ? 'not_configured' as const : activePlans.length ? 'running' as const : 'paused' as const,
    readyToSend: healthyAutomatedConnections.length > 0 && inboundReadyCount > 0 && safety.safe,
    activePlans: activePlans.length,
    totalPlans: plans.length,
    pendingMessages: pending.length,
    awaitingConfiguration: pending.filter(item => item.status === 'awaiting_configuration').length,
    nextScheduledAt: pending.length ? Math.min(...pending.map(item => item.scheduledAt)) : null,
    connections: { total: automatedConnections.length, healthy: healthyAutomatedConnections.length, inboundReady: inboundReadyCount },
    domainAuth,
    deliveryHealth: safety.health,
    issues,
    ramps,
    today: {
      candidates: candidateSummary?.discovered ?? 0,
      promoted: candidateSummary?.promoted ?? 0,
      queued: todayMessages.filter(message => message.status === 'confirmed').length,
      sent: todayMessages.filter(message => ['sent', 'delivered'].includes(message.status)).length,
      replies: threads.length,
      highIntent: threads.filter(thread => thread.intent === '高意向').length,
      deals: todayDeals?.count ?? 0,
      needsHuman: humanTasks?.count ?? 0,
    },
  }
}
