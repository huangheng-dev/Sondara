import { and, desc, eq, gte, inArray, like, sql } from 'drizzle-orm'
import { completeWithAi } from '../ai/client.js'
import { db } from '../db/client.js'
import {
  acquisitionPlans,
  businessProfiles,
  candidateContacts,
  customers,
  inboxContacts,
  messageEntries,
  messageThreads,
  radarCandidates,
  radarTasks,
  users,
} from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { isDestinationSuppressed } from '../outbox/events.js'
import { enqueueConfirmedMessage, getAvailableConnection } from '../outbox/service.js'
import { enforceAutomationCircuitBreaker, getAutomationRamp } from './production-control.js'

type OutreachCopy = { subject: string; body: string }
type CopyVariant = 'evidence-led' | 'problem-led'

type QueueAutomatedOutreachInput = {
  plan: typeof acquisitionPlans.$inferSelect
  task: typeof radarTasks.$inferSelect
  candidate: typeof radarCandidates.$inferSelect
  customer: typeof customers.$inferSelect
  contact: typeof candidateContacts.$inferSelect
}

type QueueAutomatedOutreachOptions = {
  generateCopy?: (input: QueueAutomatedOutreachInput, variant: CopyVariant, channel?: '邮件' | 'WhatsApp') => Promise<OutreachCopy>
  now?: number
}

const extractJson = (value: string) => {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1)
  return JSON.parse(source) as Partial<OutreachCopy>
}

const cleanLine = (value: string, limit: number) => value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit)

const safeCopy = (copy: Partial<OutreachCopy>, channel: '邮件' | 'WhatsApp' = '邮件'): OutreachCopy => {
  const subject = cleanLine(copy.subject ?? '', 90)
  let body = (copy.body ?? '').replace(/\r/g, '').trim().slice(0, 2_000)
  if (!subject || body.length < 40) throw new Error('AI 未生成可用的首触达内容。')
  if (!/(not relevant|not a fit|do not contact|不相关|无需联系|\bstop\b)/i.test(body)) {
    body += channel === 'WhatsApp'
      ? '\n\nIf this is not relevant, reply STOP and I will not contact you again.'
      : "\n\nIf this is not relevant, just let me know and I won't follow up."
  }
  return { subject, body }
}

const generateCopy = async (input: QueueAutomatedOutreachInput, variant: CopyVariant, channel: '邮件' | 'WhatsApp' = '邮件'): Promise<OutreachCopy> => {
  const profile = await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.workspaceId, input.plan.workspaceId)))
  const result = await completeWithAi({
    workspaceId: input.plan.workspaceId,
    timeoutMs: 30_000,
    maxTokens: 650,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content: `You write concise, factual B2B first-contact ${channel === 'WhatsApp' ? 'WhatsApp messages' : 'emails'}. Never invent facts, awards, customers, pricing, or personal familiarity. Return strict JSON with subject and body only. The body must be plain text, at most ${channel === 'WhatsApp' ? '80' : '130'} words, and contain one low-pressure call to action.`,
      },
      {
        role: 'user',
        content: JSON.stringify({
          senderCompany: profile?.company || 'Our company',
          senderWebsite: profile?.website || '',
          products: profile?.products || '',
          targetCompany: input.candidate.company,
          targetRegion: input.candidate.region,
          targetIndustry: input.candidate.industry,
          contactName: input.contact.name,
          contactRole: input.contact.role,
          verifiedSignal: input.candidate.signal,
          evidenceBasedReason: input.candidate.reason,
          language: input.plan.researchLanguage === '中文' ? 'Chinese' : 'English',
          copyVariant: variant,
          deliveryChannel: channel,
          instruction: variant === 'evidence-led'
            ? 'Lead with the supplied verified signal or public evidence, explain a plausible relevance, ask whether the topic belongs to this contact, and make it easy to decline.'
            : 'Lead with one likely operational problem or desired outcome suggested by the supplied evidence. Clearly frame it as a possibility, never as a known fact, ask one short qualifying question, and make it easy to decline.',
        }),
      },
    ],
  })
  return safeCopy(extractJson(result.content), channel)
}

const parseMetadata = (value: string) => {
  try { return JSON.parse(value) as Record<string, unknown> } catch { return {} }
}

const stableBucket = (value: string, buckets: number) => [...value].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7) % buckets

const chooseCopyVariant = async (input: QueueAutomatedOutreachInput, now: number) => {
  const priorMessages = await db.select({
    threadId: messageEntries.threadId,
    status: messageEntries.status,
    metadataJson: messageEntries.metadataJson,
    createdAt: messageEntries.createdAt,
  }).from(messageEntries).where(and(
    eq(messageEntries.workspaceId, input.plan.workspaceId),
    eq(messageEntries.direction, 'outbound'),
    gte(messageEntries.createdAt, now - 90 * 86_400_000),
    like(messageEntries.metadataJson, `%\"acquisitionPlanId\":\"${input.plan.id}\"%`),
    like(messageEntries.metadataJson, `%\"outreachStep\":0%`),
  ))
  const initial = priorMessages.map(message => ({ ...message, metadata: parseMetadata(message.metadataJson) }))
    .filter(message => message.metadata.copyVariant === 'evidence-led' || message.metadata.copyVariant === 'problem-led')
  const threadIds = [...new Set(initial.map(message => message.threadId))]
  const threads = threadIds.length ? await db.select({ id: messageThreads.id, lastInboundAt: messageThreads.lastInboundAt, intent: messageThreads.intent })
    .from(messageThreads).where(and(eq(messageThreads.workspaceId, input.plan.workspaceId), inArray(messageThreads.id, threadIds))) : []
  const threadById = new Map(threads.map(thread => [thread.id, thread]))
  const stats = (['evidence-led', 'problem-led'] as const).map(variant => {
    const assigned = initial.filter(message => message.metadata.copyVariant === variant)
    const sent = assigned.filter(message => ['sent', 'delivered'].includes(message.status))
    const replies = sent.filter(message => {
      const inboundAt = threadById.get(message.threadId)?.lastInboundAt
      return Boolean(inboundAt && inboundAt >= message.createdAt)
    })
    const highIntent = replies.filter(message => threadById.get(message.threadId)?.intent === '高意向')
    const score = ((replies.length + 1) / (sent.length + 5)) * 0.65 + ((highIntent.length + 0.5) / (sent.length + 5)) * 0.35
    return { variant, assigned: assigned.length, sent: sent.length, score }
  })
  if (stats.some(item => item.assigned < 5)) {
    const selected = [...stats].sort((a, b) => a.assigned - b.assigned || a.variant.localeCompare(b.variant))[0]
    return { variant: selected.variant, experimentMode: 'balanced' as const }
  }
  const ranked = [...stats].sort((a, b) => b.score - a.score)
  if (Math.abs(ranked[0].score - ranked[1].score) < 0.02) {
    const selected = [...stats].sort((a, b) => a.assigned - b.assigned || a.variant.localeCompare(b.variant))[0]
    return { variant: selected.variant, experimentMode: 'balanced' as const }
  }
  const winner = ranked[0]
  const challenger = stats.find(item => item.variant !== winner.variant)!
  return {
    variant: stableBucket(input.candidate.id, 4) === 0 ? challenger.variant : winner.variant,
    experimentMode: 'optimized' as const,
  }
}

const followUpCopies = (input: QueueAutomatedOutreachInput, subject: string): OutreachCopy[] => {
  const greeting = input.contact.name && input.contact.name !== '公开联系人' ? `Hello ${input.contact.name},` : 'Hello,'
  if (input.plan.researchLanguage === '中文') {
    const chineseGreeting = input.contact.name && input.contact.name !== '公开联系人' ? `${input.contact.name}，您好：` : '您好：'
    return [
      { subject, body: `${chineseGreeting}\n\n跟进一下之前的邮件。如果这个议题与贵司当前计划有关，我可以发送一份精简的技术资料供您评估；如果由其他同事负责，也烦请告知。\n\n如果并不相关，直接回复告知即可，我不会继续跟进。` },
      { subject, body: `${chineseGreeting}\n\n这是我的最后一次跟进。如果该事项是近期重点，我可以补充相关资料或安排一次简短沟通；否则我会在这里结束联系。\n\n如果并不相关，直接回复告知即可，我不会继续跟进。` },
    ]
  }
  return [
    {
      subject,
      body: `${greeting}\n\nI wanted to follow up on my earlier note. If the topic is relevant, I can send the concise technical information for your review. If someone else handles it, a pointer would be appreciated.\n\nIf this is not relevant, just let me know and I won't follow up.`,
    },
    {
      subject,
      body: `${greeting}\n\nOne final follow-up from me. If this is a current priority, I would be glad to share the relevant information or arrange a brief call. Otherwise, I will close the loop here.\n\nIf this is not relevant, just let me know and I won't follow up.`,
    },
  ]
}

const localParts = (timestamp: number, timeZone: string) => new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(new Date(timestamp)).reduce<Record<string, number>>((parts, part) => {
  if (part.type !== 'literal') parts[part.type] = Number(part.value)
  return parts
}, {})

const localToUtc = (parts: { year: number; month: number; day: number; hour: number; minute: number }, timeZone: string) => {
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  let guess = target
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = localParts(guess, timeZone)
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute)
    guess += target - represented
  }
  return guess
}

const prospectTimezone = (region: string, fallback: string) => {
  const value = region.toLowerCase()
  if (/germany|france|italy|spain|netherlands|belgium|poland|德国|法国|意大利|西班牙|荷兰|比利时|波兰/.test(value)) return 'Europe/Berlin'
  if (/united kingdom|ireland|portugal|英国|爱尔兰|葡萄牙/.test(value)) return 'Europe/London'
  if (/united states|usa|canada|美国|加拿大/.test(value)) return /california|washington|oregon|加州|华盛顿州|俄勒冈/.test(value) ? 'America/Los_Angeles' : 'America/New_York'
  if (/mexico|墨西哥/.test(value)) return 'America/Mexico_City'
  if (/brazil|argentina|巴西|阿根廷/.test(value)) return 'America/Sao_Paulo'
  if (/india|印度/.test(value)) return 'Asia/Kolkata'
  if (/japan|日本/.test(value)) return 'Asia/Tokyo'
  if (/korea|韩国/.test(value)) return 'Asia/Seoul'
  if (/australia|new zealand|澳大利亚|新西兰/.test(value)) return 'Australia/Sydney'
  if (/uae|saudi|qatar|阿联酋|沙特|卡塔尔/.test(value)) return 'Asia/Dubai'
  return fallback
}

const nextBusinessSendSlot = (now: number, timeZone: string, position: number) => {
  const parts = localParts(now, timeZone)
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  let minutes = parts.hour < 9 ? 9 * 60 : parts.hour >= 17 ? 24 * 60 + 9 * 60 : parts.hour * 60 + parts.minute + 10
  minutes += position * 15
  date.setUTCDate(date.getUTCDate() + Math.floor(minutes / (24 * 60)))
  minutes %= 24 * 60
  if (minutes >= 17 * 60) { date.setUTCDate(date.getUTCDate() + 1); minutes = 9 * 60 }
  while ([0, 6].includes(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1)
  return localToUtc({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: Math.floor(minutes / 60), minute: minutes % 60 }, timeZone)
}

export const queueAutomatedOutreach = async (input: QueueAutomatedOutreachInput, options: QueueAutomatedOutreachOptions = {}) => {
  if (!input.plan.autoOutreachEnabled || !input.plan.ownerUserId || !input.plan.enabled || input.plan.status !== 'active') {
    return { status: 'disabled' as const, reason: '全自动计划当前未处于运行状态。' }
  }
  const now = options.now ?? Date.now()
  const safety = await enforceAutomationCircuitBreaker(input.plan.workspaceId)
  if (!safety.safe) return { status: 'skipped' as const, reason: `自动触达已熔断：${safety.reasons.join('；')}` }
  const candidateEmail = input.contact.email?.trim() || null
  const emailEligible = Boolean(candidateEmail && input.contact.verificationStatus === 'verified' && input.contact.confidence >= 80)
  const emailContact = emailEligible && candidateEmail
    ? await db.$first(db.select().from(inboxContacts).where(and(
        eq(inboxContacts.workspaceId, input.plan.workspaceId),
        eq(inboxContacts.customerId, input.customer.id),
        eq(inboxContacts.email, candidateEmail),
        eq(inboxContacts.verificationStatus, 'verified'),
      )).orderBy(desc(inboxContacts.updatedAt)))
    : null
  const emailSuppressed = Boolean(candidateEmail && await isDestinationSuppressed(input.plan.workspaceId, candidateEmail))
  const emailConnection = emailContact && !emailSuppressed
    ? await getAvailableConnection(input.plan.workspaceId, '邮件')
    : null
  const whatsappContact = await db.$first(db.select().from(inboxContacts).where(and(
    eq(inboxContacts.workspaceId, input.plan.workspaceId),
    eq(inboxContacts.customerId, input.customer.id),
    eq(inboxContacts.verificationStatus, 'verified'),
    sql`${inboxContacts.phone} IS NOT NULL`,
    sql`${inboxContacts.whatsappOptedInAt} IS NOT NULL`,
  )).orderBy(desc(inboxContacts.updatedAt)))
  const whatsappConnection = whatsappContact
    ? await getAvailableConnection(input.plan.workspaceId, 'WhatsApp')
    : null
  const channel: '邮件' | 'WhatsApp' = emailContact && emailConnection ? '邮件' : whatsappContact && whatsappConnection ? 'WhatsApp' : '邮件'
  const inboxContact = channel === '邮件' ? emailContact : whatsappContact
  if (!inboxContact) {
    return { status: 'skipped' as const, reason: emailSuppressed
      ? '邮箱位于退订或抑制名单，且没有已授权的 WhatsApp 联系方式。'
      : '没有达到自动触达门槛的已验证邮箱或已授权 WhatsApp 联系方式。' }
  }
  if (channel === '邮件' && !emailConnection) {
    return { status: 'skipped' as const, reason: '没有健康可用的邮件发送服务，也没有可用的 WhatsApp 备用渠道。' }
  }

  const recentOutbound = await db.$first(db.select({ id: messageEntries.id }).from(messageEntries)
    .innerJoin(messageThreads, eq(messageThreads.id, messageEntries.threadId))
    .where(and(
      eq(messageEntries.workspaceId, input.plan.workspaceId),
      eq(messageThreads.contactId, inboxContact.id),
      eq(messageEntries.direction, 'outbound'),
      inArray(messageEntries.status, ['confirmed', 'queued', 'sent', 'delivered']),
      gte(messageEntries.createdAt, now - 30 * 86_400_000),
    )))
  if (recentOutbound) return { status: 'skipped' as const, reason: '该联系人 30 天内已有触达记录。' }

  const ramp = await getAutomationRamp({ workspaceId: input.plan.workspaceId, planId: input.plan.id, configuredLimit: input.plan.dailyCandidateLimit, now })
  if (ramp.remaining <= 0) return { status: 'skipped' as const, reason: `${ramp.stage}阶段已达到每天 ${ramp.limit} 条的安全上限。` }

  const experiment = await chooseCopyVariant(input, now)
  const copy = safeCopy(await (options.generateCopy ?? generateCopy)(input, experiment.variant, channel), channel)
  const sender = await db.$first(db.select({ displayName: users.displayName }).from(users).where(eq(users.id, input.plan.ownerUserId)))
  const threadId = createId('mth')
  const messageId = createId('msg')
  const sendTimezone = prospectTimezone(input.candidate.region, input.plan.timezone)
  const scheduledAt = nextBusinessSendSlot(now, sendTimezone, ramp.used)
  await db.transaction(async tx => {
    await tx.insert(messageThreads).values({
      id: threadId, workspaceId: input.plan.workspaceId, contactId: inboxContact.id, customerId: input.customer.id,
      campaignId: null, subject: copy.subject, channel, intent: '待判断', status: 'open',
      assigneeUserId: input.plan.ownerUserId, lastMessagePreview: copy.body.slice(0, 200), lastMessageAt: now,
      lastInboundAt: null, unreadCount: 0, createdAt: now, updatedAt: now,
    })
    await tx.insert(messageEntries).values({
      id: messageId, workspaceId: input.plan.workspaceId, threadId, direction: 'outbound', messageType: 'text',
      body: copy.body, status: 'confirmed', channel, senderLabel: sender?.displayName ?? '自动获客助手',
      confirmedByUserId: input.plan.ownerUserId, confirmedAt: now,
      metadataJson: JSON.stringify({ deliveryMode: 'outbox', automationApprovedByPlan: true, acquisitionPlanId: input.plan.id, radarTaskId: input.task.id, candidateId: input.candidate.id, outreachStep: 0, copyVariant: experiment.variant, experimentMode: experiment.experimentMode, sendTimezone }),
      createdAt: now, updatedAt: now,
    })
  })
  const job = await enqueueConfirmedMessage({ workspaceId: input.plan.workspaceId, messageId, threadId, channel, scheduledAt })
  const followUpJobs: Array<{ id: string; scheduledAt: number }> = []
  if (job.status === 'queued' && channel === '邮件') {
    const followUps = followUpCopies(input, copy.subject)
    const followUpTimes = [
      nextBusinessSendSlot(scheduledAt + 3 * 86_400_000, sendTimezone, 0),
      nextBusinessSendSlot(scheduledAt + 7 * 86_400_000, sendTimezone, 0),
    ]
    for (const [index, followUp] of followUps.entries()) {
      const followUpMessageId = createId('msg')
      await db.insert(messageEntries).values({
        id: followUpMessageId, workspaceId: input.plan.workspaceId, threadId, direction: 'outbound', messageType: 'text',
        body: followUp.body, status: 'confirmed', channel: '邮件', senderLabel: sender?.displayName ?? '自动获客助手',
        confirmedByUserId: input.plan.ownerUserId, confirmedAt: now,
        metadataJson: JSON.stringify({ deliveryMode: 'outbox', automationApprovedByPlan: true, acquisitionPlanId: input.plan.id, radarTaskId: input.task.id, candidateId: input.candidate.id, outreachStep: index + 1, copyVariant: experiment.variant, experimentMode: experiment.experimentMode, sendTimezone }),
        createdAt: now, updatedAt: now,
      })
      const followUpJob = await enqueueConfirmedMessage({
        workspaceId: input.plan.workspaceId, messageId: followUpMessageId, threadId, channel: '邮件', scheduledAt: followUpTimes[index],
      })
      if (followUpJob.status === 'queued') followUpJobs.push({ id: followUpJob.id, scheduledAt: followUpTimes[index] })
    }
  }
  if (job.status === 'queued') {
    await db.update(customers).set({
      interaction: `自动${channel}首触达已排队`,
      nextAction: '等待客户回复并识别意向',
      dueAt: scheduledAt + (channel === '邮件' ? 3 : 1) * 86_400_000,
      updatedAt: now,
    }).where(eq(customers.id, input.customer.id))
  }
  return { status: job.status === 'queued' ? 'queued' as const : 'skipped' as const, reason: job.lastError ?? undefined, jobId: job.id, scheduledAt, followUpJobs, channel, copyVariant: experiment.variant, experimentMode: experiment.experimentMode, sendTimezone, ramp }
}
