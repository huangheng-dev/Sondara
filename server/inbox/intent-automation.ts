import { and, eq, inArray } from 'drizzle-orm'
import { completeWithAi } from '../ai/client.js'
import { db } from '../db/client.js'
import {
  contactSuppressions,
  customers,
  deals,
  messageThreads,
  tasks,
} from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { createNotification, recordOutcome } from '../automation/closed-loop.js'

type InboundIntent = 'high_intent' | 'follow_up' | 'negative' | 'opt_out' | 'unclear'

type IntentResult = {
  intent: InboundIntent
  confidence: number
  reason: string
  nextAction: string
}

type ApplyInboundIntentInput = {
  workspaceId: string
  threadId: string
  customerId: string | null
  fromAddress: string
  subject: string
  body: string
  receivedAt: number
}

const optOutPattern = /\b(unsubscribe|remove me|stop (?:emailing|contacting)|do not (?:email|contact)|no more emails)\b|退订|取消订阅|不要再(?:发|联系)|停止联系/i
const negativePattern = /\b(not interested|no interest|not a fit|wrong person|not relevant|no need|decline)\b|不感兴趣|不需要|不相关|暂不考虑|拒绝/i
const highIntentPattern = /\b(quote|quotation|pricing|price list|rfq|rfi|purchase|procurement|sample|catalog(?:ue)?|specification|datasheet|meeting|call|distributor|agent)\b|报价|询价|采购|样品|目录|规格|参数|会议|电话沟通|经销商|代理商/i
const followUpPattern = /\b(follow up|later|next (?:week|month)|send (?:me|us)|more information|keep in touch)\b|稍后|下周|下个月|更多资料|保持联系|后续联系/i

const classifyByRules = (text: string): IntentResult | null => {
  if (optOutPattern.test(text)) return { intent: 'opt_out', confidence: 100, reason: '客户明确要求停止联系。', nextAction: '停止所有后续触达' }
  if (negativePattern.test(text)) return { intent: 'negative', confidence: 92, reason: '客户明确表示不感兴趣或不匹配。', nextAction: '记录原因并停止自动触达' }
  if (highIntentPattern.test(text)) return { intent: 'high_intent', confidence: 90, reason: '回复包含报价、采购、资料或沟通等明确需求。', nextAction: '4 小时内人工确认需求并推进商机' }
  if (followUpPattern.test(text)) return { intent: 'follow_up', confidence: 84, reason: '客户提出稍后联系或需要补充资料。', nextAction: '按客户要求安排下一次跟进' }
  return null
}

const parseAiResult = (content: string): IntentResult => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)
  const parsed = JSON.parse(source) as Partial<IntentResult>
  if (!['high_intent', 'follow_up', 'negative', 'opt_out', 'unclear'].includes(parsed.intent ?? '')) throw new Error('AI 返回了无效意向。')
  return {
    intent: parsed.intent as InboundIntent,
    confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
    reason: String(parsed.reason || 'AI 根据客户回复完成判断。').slice(0, 240),
    nextAction: String(parsed.nextAction || '人工查看回复并判断下一步。').slice(0, 160),
  }
}

const classifyWithAi = async (input: ApplyInboundIntentInput): Promise<IntentResult> => {
  const result = await completeWithAi({
    workspaceId: input.workspaceId,
    timeoutMs: 12_000,
    maxTokens: 300,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: 'Classify an inbound B2B email. Return strict JSON only: {"intent":"high_intent|follow_up|negative|opt_out|unclear","confidence":0-100,"reason":"short Chinese explanation","nextAction":"short Chinese action"}. Treat explicit opt-out as opt_out. Do not infer buying intent from politeness alone.',
      },
      { role: 'user', content: JSON.stringify({ subject: input.subject, body: input.body.slice(0, 5_000) }) },
    ],
  })
  return parseAiResult(result.content)
}

const uiIntent = (intent: InboundIntent) => intent === 'high_intent' ? '高意向' : intent === 'follow_up' ? '待跟进' : '待判断'

export const applyInboundIntentAutomation = async (
  input: ApplyInboundIntentInput,
  options: { classify?: (input: ApplyInboundIntentInput) => Promise<IntentResult> } = {},
) => {
  const combined = `${input.subject}\n${input.body}`
  let result = classifyByRules(combined)
  if (!result) {
    try {
      result = await (options.classify ?? classifyWithAi)(input)
    } catch {
      result = { intent: 'unclear', confidence: 0, reason: 'AI 暂时不可用，已保留给人工判断。', nextAction: '人工查看回复并判断下一步' }
    }
  }

  const now = Date.now()
  const threadStatus = ['negative', 'opt_out'].includes(result.intent) ? 'closed' : 'open'
  await db.update(messageThreads).set({ intent: uiIntent(result.intent), status: threadStatus, updatedAt: now }).where(and(
    eq(messageThreads.id, input.threadId),
    eq(messageThreads.workspaceId, input.workspaceId),
  ))

  if (result.intent === 'high_intent') await createNotification({
    workspaceId: input.workspaceId, notificationType: 'high_intent', tone: 'warning', title: '收到高意向客户回复',
    description: result.nextAction, entityType: 'message_thread', entityId: input.threadId,
    actionPath: `/inbox?thread=${encodeURIComponent(input.threadId)}`, dedupeKey: `high-intent:${input.threadId}:${input.receivedAt}`,
  })

  if (result.intent === 'opt_out') {
    const destination = input.fromAddress.trim().toLowerCase()
    await db.insert(contactSuppressions).values({
      id: createId('sup'), workspaceId: input.workspaceId, channel: 'email', destination,
      reason: '客户回复明确退订', source: 'inbound_intent', active: true, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [contactSuppressions.workspaceId, contactSuppressions.channel, contactSuppressions.destination],
      set: { reason: '客户回复明确退订', source: 'inbound_intent', active: true, updatedAt: now },
    })
  }

  if (!input.customerId) return result
  const customer = await db.$first(db.select().from(customers).where(and(
    eq(customers.id, input.customerId),
    eq(customers.workspaceId, input.workspaceId),
  )))
  if (!customer) return result

  if (['high_intent', 'negative', 'opt_out'].includes(result.intent)) await recordOutcome({
    workspaceId: input.workspaceId, actorUserId: customer.ownerUserId, customerId: customer.id, threadId: input.threadId,
    outcome: result.intent === 'high_intent' ? 'replied_high_intent' : result.intent === 'opt_out' ? 'unsubscribed' : 'disqualified',
    reasonCode: result.intent, note: result.reason, source: 'inbound_intent', occurredAt: input.receivedAt,
  })

  const customerUpdate = result.intent === 'high_intent'
    ? { stage: '有商机', interaction: '客户回复：高意向', nextAction: result.nextAction, dueAt: input.receivedAt + 4 * 60 * 60_000, updatedAt: now }
    : result.intent === 'follow_up'
      ? { interaction: '客户回复：待跟进', nextAction: result.nextAction, dueAt: input.receivedAt + 24 * 60 * 60_000, updatedAt: now }
      : result.intent === 'negative' || result.intent === 'opt_out'
        ? { interaction: result.intent === 'opt_out' ? '客户已退订' : '客户暂无意向', nextAction: '无需继续自动触达', dueAt: null, updatedAt: now }
        : { interaction: '收到客户回复，待判断', nextAction: result.nextAction, dueAt: input.receivedAt + 24 * 60 * 60_000, updatedAt: now }
  await db.update(customers).set(customerUpdate).where(eq(customers.id, customer.id))

  if (['negative', 'opt_out'].includes(result.intent)) return result
  const taskTitle = result.intent === 'high_intent' ? `跟进高意向回复 · ${customer.company}` : `查看客户回复 · ${customer.company}`
  const existingTask = await db.$first(db.select({ id: tasks.id }).from(tasks).where(and(
    eq(tasks.workspaceId, input.workspaceId),
    eq(tasks.customerId, customer.id),
    eq(tasks.status, 'open'),
    inArray(tasks.source, ['AI 回复识别', '客户回复']),
  )))
  if (!existingTask) {
    await db.insert(tasks).values({
      id: createId('tsk'), workspaceId: input.workspaceId, customerId: customer.id, title: taskTitle,
      entityType: 'message_thread', entityId: input.threadId, actionPath: `/inbox?thread=${encodeURIComponent(input.threadId)}`,
      priority: result.intent === 'high_intent' ? '高' : '中',
      dueAt: result.intent === 'high_intent' ? input.receivedAt + 4 * 60 * 60_000 : input.receivedAt + 24 * 60 * 60_000,
      dueLabel: result.intent === 'high_intent' ? '4 小时内' : '24 小时内', company: customer.company,
      nextAction: result.nextAction, impact: result.reason, source: 'AI 回复识别', status: 'open',
      ownerUserId: customer.ownerUserId, createdAt: now, updatedAt: now,
    })
  }

  if (result.intent === 'high_intent') {
    await db.insert(deals).values({
      id: createId('deal'), workspaceId: input.workspaceId, customerId: customer.id, company: customer.company,
      stage: '线索确认', probability: 30, valueAmount: customer.estimatedValue, currency: 'CNY',
      ownerLabel: '负责人', nextAction: result.nextAction, expectedCloseAt: now + 60 * 86_400_000,
      risk: '需要人工确认真实需求、预算和决策链', source: '客户高意向回复', stageEnteredAt: now,
      ownerUserId: customer.ownerUserId, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [deals.workspaceId, deals.company],
      set: { customerId: customer.id, nextAction: result.nextAction, probability: 30, archivedAt: null, updatedAt: now },
    })
  }
  return result
}
