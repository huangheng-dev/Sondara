import { and, desc, eq } from 'drizzle-orm'
import { completeWithAi } from '../ai/client.js'
import { db } from '../db/client.js'
import { businessProfiles, customers, inboxContacts, knowledgeItems, messageEntries, messageThreads } from '../db/schema.js'

export type ReplySuggestion = {
  status: 'ready' | 'fallback' | 'blocked'
  source: 'ai' | 'rule' | 'none'
  draft: string
  rationale: string
  nextAction: string
  missingInformation: string[]
  warnings: string[]
  language: string
  confidence: number
  requiresHumanConfirmation: true
  generatedAt: number
  model?: string
}

const parseJson = (content: string) => {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  return JSON.parse(fenced ?? content.slice(start, end + 1)) as Record<string, unknown>
}

const strings = (value: unknown, maximum = 6) => Array.isArray(value)
  ? value.map(item => String(item).trim()).filter(Boolean).slice(0, maximum)
  : []

const isMostlyChinese = (value: string) => (value.match(/[\u3400-\u9fff]/g)?.length ?? 0) >= 3

const fallbackSuggestion = (input: {
  contactName: string
  company: string
  inbound: string
  intent: string
  products: string
}): Omit<ReplySuggestion, 'generatedAt'> => {
  const chinese = isMostlyChinese(input.inbound)
  const highIntent = input.intent === '高意向'
  const missingInformation = chinese
    ? ['具体应用或项目范围', '数量与交付时间', '关键技术参数'].filter(item => !input.inbound.includes(item.slice(0, 2)))
    : ['application or project scope', 'quantity and required delivery date', 'key technical requirements']
  const product = input.products.trim().slice(0, 120)
  const draft = chinese
    ? `您好${input.contactName ? ` ${input.contactName}` : ''}，感谢您的回复。${product ? `关于您关注的需求，我们可以结合${product}准备针对性资料。` : '我们可以根据您的应用场景准备针对性资料。'}为避免提供不准确的信息，方便补充项目用途、关键参数、预计数量和期望时间吗？收到后我们会尽快确认可行方案与下一步沟通安排。`
    : `Hello${input.contactName ? ` ${input.contactName}` : ''}, thank you for your reply. ${product ? `We can prepare relevant information for ${product}. ` : ''}To make sure we provide accurate information, could you share the application, key requirements, expected quantity, and target timeline? We will review the details and confirm the most relevant next step.`
  return {
    status: 'fallback', source: 'rule', draft,
    rationale: highIntent ? '客户已表达具体兴趣，建议先补齐需求信息，再承诺方案、价格或交期。' : '先确认需求和时间计划，避免在信息不足时做出承诺。',
    nextAction: highIntent ? '人工核对回复后尽快发送，并确认需求、预算、时间和决策人。' : '人工确认语气和事实后发送。',
    missingInformation,
    warnings: ['未核验价格、库存、认证和交付周期前，不应在回复中做出确定承诺。'],
    language: chinese ? '简体中文' : 'English', confidence: 62, requiresHumanConfirmation: true,
  }
}

export const generateReplySuggestion = async (input: { workspaceId: string; threadId: string }): Promise<ReplySuggestion | null> => {
  const thread = await db.$first(db.select().from(messageThreads).where(and(
    eq(messageThreads.workspaceId, input.workspaceId), eq(messageThreads.id, input.threadId),
  )))
  if (!thread) return null
  const contact = await db.$first(db.select().from(inboxContacts).where(and(
    eq(inboxContacts.workspaceId, input.workspaceId), eq(inboxContacts.id, thread.contactId),
  )))
  const history = await db.select().from(messageEntries).where(and(
    eq(messageEntries.workspaceId, input.workspaceId), eq(messageEntries.threadId, thread.id),
  )).orderBy(desc(messageEntries.createdAt)).limit(10)
  const latestInbound = history.find(message => message.direction === 'inbound')
  const generatedAt = Date.now()
  if (!latestInbound) return {
    status: 'blocked', source: 'none', draft: '', rationale: '当前会话还没有客户回复。', nextAction: '等待客户回复后再生成建议。',
    missingInformation: [], warnings: ['不能在没有客户回复的情况下生成回复建议。'], language: '待识别', confidence: 0,
    requiresHumanConfirmation: true, generatedAt,
  }
  if (thread.status !== 'open') return {
    status: 'blocked', source: 'none', draft: '', rationale: '会话已经关闭或归档。', nextAction: '如需继续沟通，请先人工确认客户没有拒绝或退订。',
    missingInformation: [], warnings: ['已关闭会话不得自动建议继续触达。'], language: isMostlyChinese(latestInbound.body) ? '简体中文' : 'English', confidence: 0,
    requiresHumanConfirmation: true, generatedAt,
  }

  const [profile, customer, knowledge] = await Promise.all([
    db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.workspaceId, input.workspaceId))),
    thread.customerId ? db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, input.workspaceId), eq(customers.id, thread.customerId)))) : Promise.resolve(undefined),
    db.select({ title: knowledgeItems.title, summary: knowledgeItems.summary, itemType: knowledgeItems.itemType })
      .from(knowledgeItems).where(and(eq(knowledgeItems.workspaceId, input.workspaceId), eq(knowledgeItems.status, '已启用')))
      .orderBy(desc(knowledgeItems.updatedAt)).limit(6),
  ])
  const fallback = fallbackSuggestion({
    contactName: contact?.name ?? '', company: contact?.company ?? customer?.company ?? '', inbound: latestInbound.body,
    intent: thread.intent, products: profile?.products ?? '',
  })
  try {
    const completion = await completeWithAi({
      workspaceId: input.workspaceId, timeoutMs: 15_000, maxTokens: 800, temperature: 0.15,
      messages: [
        {
          role: 'system',
          content: `You are a cautious B2B sales reply copilot. Draft a concise reply in the customer's language. Use only facts in the supplied context. Never invent prices, stock, certifications, delivery dates, customers, attachments, test results or legal commitments. Ask for missing decision-critical information. Do not claim that files are attached. This is a draft that must be reviewed by a human and must never be sent automatically. Return strict JSON only: {"draft":"...","rationale":"Chinese explanation","nextAction":"Chinese action","missingInformation":["..."],"warnings":["..."],"language":"...","confidence":0-100}.`,
        },
        {
          role: 'user',
          content: JSON.stringify({
            thread: { subject: thread.subject, intent: thread.intent, channel: thread.channel },
            contact: contact ? { name: contact.name, company: contact.company, jobTitle: contact.jobTitle, region: contact.region } : null,
            customer: customer ? { industry: customer.industry, region: customer.region, stage: customer.stage, signal: customer.signal, nextAction: customer.nextAction } : null,
            business: profile ? { company: profile.company, website: profile.website, products: profile.products, regions: profile.regions, customers: profile.customers, exclusions: profile.exclusions } : null,
            approvedKnowledge: knowledge,
            conversation: [...history].reverse().map(message => ({ direction: message.direction, body: message.body.slice(0, 2_000) })),
          }),
        },
      ],
    })
    const parsed = parseJson(completion.content)
    const draft = String(parsed.draft ?? '').trim().slice(0, 4_000)
    if (!draft) throw new Error('AI 回复建议缺少正文')
    return {
      status: 'ready', source: 'ai', draft,
      rationale: String(parsed.rationale ?? fallback.rationale).trim().slice(0, 500),
      nextAction: String(parsed.nextAction ?? fallback.nextAction).trim().slice(0, 300),
      missingInformation: strings(parsed.missingInformation), warnings: strings(parsed.warnings),
      language: String(parsed.language ?? fallback.language).trim().slice(0, 80),
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 0)),
      requiresHumanConfirmation: true, generatedAt, model: completion.model,
    }
  } catch {
    return { ...fallback, generatedAt }
  }
}
