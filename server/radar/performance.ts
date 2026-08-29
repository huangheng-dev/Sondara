import { and, eq, gte, inArray, like } from 'drizzle-orm'
import { db } from '../db/client.js'
import {
  acquisitionPlans,
  deals,
  messageEntries,
  messageThreads,
  outboxJobs,
  outboundChannelConnections,
  radarCandidates,
  radarTasks,
} from '../db/schema.js'
import { prioritizeSources } from './optimization.js'

const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 1_000) / 10 : 0
const metadata = (value: string) => {
  try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
}

export const getAcquisitionPlanPerformance = async (input: {
  workspaceId: string
  planId: string
  days?: number
}) => {
  const days = Math.min(90, Math.max(7, input.days ?? 30))
  const since = Date.now() - days * 86_400_000
  const plan = await db.$first(db.select().from(acquisitionPlans).where(and(
    eq(acquisitionPlans.workspaceId, input.workspaceId), eq(acquisitionPlans.id, input.planId),
  )))
  if (!plan) return null
  const taskRows = await db.select({ id: radarTasks.id }).from(radarTasks).where(and(
    eq(radarTasks.workspaceId, input.workspaceId), eq(radarTasks.acquisitionPlanId, plan.id), gte(radarTasks.createdAt, since),
  ))
  const taskIds = taskRows.map(row => row.id)
  const candidates = taskIds.length ? await db.select().from(radarCandidates).where(and(
    eq(radarCandidates.workspaceId, input.workspaceId), inArray(radarCandidates.radarTaskId, taskIds), gte(radarCandidates.discoveredAt, since),
  )) : []
  const automatedMessages = await db.select({
    id: messageEntries.id, threadId: messageEntries.threadId, status: messageEntries.status,
    metadataJson: messageEntries.metadataJson, createdAt: messageEntries.createdAt,
  }).from(messageEntries).where(and(
    eq(messageEntries.workspaceId, input.workspaceId), eq(messageEntries.direction, 'outbound'),
    gte(messageEntries.createdAt, since), like(messageEntries.metadataJson, '%"automationApprovedByPlan":true%'),
    like(messageEntries.metadataJson, `%"acquisitionPlanId":"${plan.id}"%`),
  ))
  const parsedMessages = automatedMessages.map(message => ({ ...message, metadata: metadata(message.metadataJson) }))
  const initialMessages = parsedMessages.filter(message => Number(message.metadata.outreachStep) === 0)
  const initialMessageIds = initialMessages.map(message => message.id)
  const threadIds = [...new Set(initialMessages.map(message => message.threadId))]
  const threads = threadIds.length ? await db.select().from(messageThreads).where(and(
    eq(messageThreads.workspaceId, input.workspaceId), inArray(messageThreads.id, threadIds),
  )) : []
  const jobs = initialMessageIds.length ? await db.select().from(outboxJobs).where(and(
    eq(outboxJobs.workspaceId, input.workspaceId), inArray(outboxJobs.messageId, initialMessageIds),
  )) : []
  const customerIds = [...new Set(threads.map(thread => thread.customerId).filter((value): value is string => Boolean(value)))]
  const dealRows = customerIds.length ? await db.select({ customerId: deals.customerId }).from(deals).where(and(
    eq(deals.workspaceId, input.workspaceId), inArray(deals.customerId, customerIds),
    eq(deals.source, '客户高意向回复'), gte(deals.createdAt, since),
  )) : []
  const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]))
  const initialByThread = new Map(initialMessages.map(message => [message.threadId, message]))
  const repliedThreads = threads.filter(thread => Boolean(thread.lastInboundAt && thread.lastInboundAt >= (initialByThread.get(thread.id)?.createdAt ?? 0)))
  const sent = initialMessages.filter(message => ['sent', 'delivered'].includes(message.status)).length
  const delivered = initialMessages.filter(message => message.status === 'delivered').length
  const replies = repliedThreads.length
  const highIntent = repliedThreads.filter(thread => thread.intent === '高意向').length
  const promoted = candidates.filter(candidate => candidate.status === 'saved').length
  const highMatch = candidates.filter(candidate => candidate.score >= plan.minAutoScore).length
  const failures = jobs.filter(job => job.status === 'failed').length
  const cancelledFollowUps = parsedMessages.filter(message => Number(message.metadata.outreachStep) > 0 && message.status === 'cancelled').length
  const activeSequences = threads.filter(thread => !thread.lastInboundAt && parsedMessages.some(message => message.threadId === thread.id && message.status === 'confirmed')).length
  const sourceMap = new Map<string, { source: string; candidates: number; highMatch: number; promoted: number; outreach: number; replies: number }>()
  for (const candidate of candidates) {
    const current = sourceMap.get(candidate.source) ?? { source: candidate.source, candidates: 0, highMatch: 0, promoted: 0, outreach: 0, replies: 0 }
    current.candidates += 1
    if (candidate.score >= plan.minAutoScore) current.highMatch += 1
    if (candidate.status === 'saved') current.promoted += 1
    sourceMap.set(candidate.source, current)
  }
  for (const message of initialMessages) {
    const candidate = candidateById.get(String(message.metadata.candidateId ?? ''))
    if (!candidate) continue
    const current = sourceMap.get(candidate.source)
    if (!current) continue
    current.outreach += 1
    const thread = threads.find(item => item.id === message.threadId)
    if (thread?.lastInboundAt && thread.lastInboundAt >= message.createdAt) current.replies += 1
  }
  const sources = prioritizeSources([...sourceMap.values()].map(item => ({
    ...item, qualificationRate: percent(item.promoted, item.candidates), replyRate: percent(item.replies, item.outreach),
  })))
  const threadById = new Map(threads.map(thread => [thread.id, thread]))
  const experiments = (['evidence-led', 'problem-led'] as const).map(variant => {
    const messages = initialMessages.filter(message => message.metadata.copyVariant === variant)
    const sentMessages = messages.filter(message => ['sent', 'delivered'].includes(message.status))
    const replied = sentMessages.filter(message => {
      const inboundAt = threadById.get(message.threadId)?.lastInboundAt
      return Boolean(inboundAt && inboundAt >= message.createdAt)
    })
    const highIntentReplies = replied.filter(message => threadById.get(message.threadId)?.intent === '高意向')
    return {
      variant,
      label: variant === 'evidence-led' ? '证据切入' : '问题切入',
      assigned: messages.length,
      sent: sentMessages.length,
      replies: replied.length,
      highIntent: highIntentReplies.length,
      replyRate: percent(replied.length, sentMessages.length),
      highIntentRate: percent(highIntentReplies.length, sentMessages.length),
      score: Math.round((percent(replied.length, sentMessages.length) * 0.6 + percent(highIntentReplies.length, sentMessages.length) * 0.4) * 10) / 10,
    }
  })
  const experimentReady = experiments.every(item => item.sent >= 5)
  const experimentWinner = experimentReady && Math.abs(experiments[0].score - experiments[1].score) >= 2
    ? [...experiments].sort((a, b) => b.score - a.score)[0].variant
    : null
  const copyExperiment = {
    status: initialMessages.length === 0 ? 'waiting' as const : experimentReady ? 'optimizing' as const : 'collecting' as const,
    winner: experimentWinner,
    variants: experiments,
  }
  const healthyConnection = await db.$first(db.select({ id: outboundChannelConnections.id }).from(outboundChannelConnections).where(and(
    eq(outboundChannelConnections.workspaceId, input.workspaceId), eq(outboundChannelConnections.enabled, true), eq(outboundChannelConnections.status, 'available'),
  )))
  const metrics = {
    candidates: candidates.length, highMatch, promoted, outreachQueued: initialMessages.length, outreachSent: sent,
    delivered, replies, highIntent, deals: dealRows.length, failures, cancelledFollowUps, activeSequences,
    qualificationRate: percent(promoted, candidates.length), deliveryRate: percent(delivered, sent),
    replyRate: percent(replies, sent), highIntentRate: percent(highIntent, replies), opportunityRate: percent(dealRows.length, replies),
  }
  const recommendations: Array<{ level: 'info' | 'warning' | 'success'; title: string; description: string; actionPath?: string }> = []
  if (plan.autoOutreachEnabled && !healthyConnection) recommendations.push({ level: 'warning', title: '发送服务尚未就绪', description: '自动研究和客户入库会继续，但触达序列会等待健康可用的邮件连接。', actionPath: '/settings/integrations' })
  if (candidates.length >= 20 && metrics.qualificationRate < 5) recommendations.push({ level: 'warning', title: '合格客户比例偏低', description: '建议收紧客户画像、地区和来源条件；优先保留高匹配来源。', actionPath: '/icp' })
  if (sent >= 10 && metrics.replyRate < 3) recommendations.push({ level: 'warning', title: '回复率偏低', description: '下一轮应调整价值主张和首封内容，并减少低意向名单触达。', actionPath: '/content' })
  if (sent >= 10 && percent(failures, sent + failures) > 5) recommendations.push({ level: 'warning', title: '发送失败率偏高', description: '检查域名信誉、发件服务和邮箱验证质量，暂停扩大发送量。', actionPath: '/settings/integrations' })
  if (replies >= 5 && metrics.highIntentRate < 20) recommendations.push({ level: 'info', title: '回复质量仍可提升', description: '优先采用有采购、扩张或项目证据的数据源，而不是扩大普通企业名单。', actionPath: '/radar' })
  if (!recommendations.length) recommendations.push({ level: 'success', title: '自动化链路运行正常', description: initialMessages.length ? '继续观察回复和商机转化；系统已对重复触达和客户回复设置停止保护。' : '当前尚无足够触达样本，完成首轮后会生成针对性优化建议。' })
  const health = recommendations.some(item => item.level === 'warning') ? 'warning' : 'healthy'
  return { planId: plan.id, planName: plan.name, periodDays: days, health, metrics, sources, copyExperiment, recommendations }
}
