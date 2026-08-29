import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { acquisitionPlans, customerOutcomes, customers, deals, learningSnapshots, messageThreads, radarCandidates, radarTasks } from '../db/schema.js'
import type { DiscoveredCandidate } from './types.js'

export const FEEDBACK_MIN_OUTCOMES = 8
export const FEEDBACK_MIN_FEATURE_SAMPLES = 3
export const FEEDBACK_MAX_SCORE_ADJUSTMENT = 8

type FeedbackOutcome = 'positive' | 'negative'
type FeedbackFeatureKind = 'source' | 'industry' | 'region' | 'signal'

export type AcquisitionFeedbackSample = {
  outcome: FeedbackOutcome
  source: string
  industry: string
  region: string
  signal: string
}

export type AcquisitionFeedbackFeature = {
  key: string
  kind: FeedbackFeatureKind
  label: string
  samples: number
  positive: number
  negative: number
  positiveRate: number
  adjustment: number
}

export type AcquisitionFeedbackModel = {
  status: 'waiting' | 'learning' | 'active'
  minimumOutcomes: number
  labeledOutcomes: number
  positiveOutcomes: number
  negativeOutcomes: number
  basePositiveRate: number
  maxScoreAdjustment: number
  positiveFeatures: AcquisitionFeedbackFeature[]
  riskFeatures: AcquisitionFeedbackFeature[]
  features: AcquisitionFeedbackFeature[]
  message: string
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))
const percent = (part: number, whole: number) => whole ? Math.round(part / whole * 1_000) / 10 : 0
const normalizeCompany = (value: string) => value.trim().toLocaleLowerCase().replace(/[\s.,，。()（）\-_'"“”]+/g, '')
const ignoredFeature = /^(待补全|待识别|未知|其他|全球|数据源|公开网络)$/

const values = (value: string) => [...new Set(value
  .split(/\s*[·,，;；|]+\s*/)
  .map(item => item.trim().replace(/\s+/g, ' '))
  .filter(item => item && item.length <= 80 && !ignoredFeature.test(item)))]

const sampleFeatures = (sample: Pick<AcquisitionFeedbackSample, 'source' | 'industry' | 'region' | 'signal'>) => {
  const result: Array<{ key: string; kind: FeedbackFeatureKind; label: string }> = []
  const append = (kind: FeedbackFeatureKind, raw: string) => values(raw).forEach(label => result.push({ key: `${kind}:${label.toLocaleLowerCase()}`, kind, label }))
  append('source', sample.source)
  append('industry', sample.industry)
  append('region', sample.region)
  append('signal', sample.signal)
  return result
}

export const buildAcquisitionFeedbackModel = (samples: AcquisitionFeedbackSample[]): AcquisitionFeedbackModel => {
  const positiveOutcomes = samples.filter(sample => sample.outcome === 'positive').length
  const negativeOutcomes = samples.length - positiveOutcomes
  const basePositiveRate = percent(positiveOutcomes, samples.length)
  if (samples.length < FEEDBACK_MIN_OUTCOMES) return {
    status: 'waiting', minimumOutcomes: FEEDBACK_MIN_OUTCOMES, labeledOutcomes: samples.length,
    positiveOutcomes, negativeOutcomes, basePositiveRate, maxScoreAdjustment: FEEDBACK_MAX_SCORE_ADJUSTMENT,
    positiveFeatures: [], riskFeatures: [], features: [],
    message: `已收集 ${samples.length} 条明确结果，至少需要 ${FEEDBACK_MIN_OUTCOMES} 条才会校准候选评分。`,
  }

  const globalRate = positiveOutcomes / samples.length
  const buckets = new Map<string, { kind: FeedbackFeatureKind; label: string; samples: number; positive: number }>()
  for (const sample of samples) for (const feature of sampleFeatures(sample)) {
    const bucket = buckets.get(feature.key) ?? { kind: feature.kind, label: feature.label, samples: 0, positive: 0 }
    bucket.samples += 1
    if (sample.outcome === 'positive') bucket.positive += 1
    buckets.set(feature.key, bucket)
  }
  const priorWeight = 4
  const features = [...buckets.entries()].flatMap(([key, bucket]): AcquisitionFeedbackFeature[] => {
    if (bucket.samples < FEEDBACK_MIN_FEATURE_SAMPLES) return []
    const posteriorRate = (bucket.positive + globalRate * priorWeight) / (bucket.samples + priorWeight)
    const adjustment = Math.round(clamp((posteriorRate - globalRate) * 24, -FEEDBACK_MAX_SCORE_ADJUSTMENT, FEEDBACK_MAX_SCORE_ADJUSTMENT))
    if (!adjustment) return []
    return [{ key, kind: bucket.kind, label: bucket.label, samples: bucket.samples, positive: bucket.positive,
      negative: bucket.samples - bucket.positive, positiveRate: percent(bucket.positive, bucket.samples), adjustment }]
  })
  const positiveFeatures = features.filter(feature => feature.adjustment > 0).sort((a, b) => b.adjustment - a.adjustment || b.samples - a.samples).slice(0, 5)
  const riskFeatures = features.filter(feature => feature.adjustment < 0).sort((a, b) => a.adjustment - b.adjustment || b.samples - a.samples).slice(0, 5)
  const status = features.length ? 'active' as const : 'learning' as const
  return {
    status, minimumOutcomes: FEEDBACK_MIN_OUTCOMES, labeledOutcomes: samples.length, positiveOutcomes, negativeOutcomes,
    basePositiveRate, maxScoreAdjustment: FEEDBACK_MAX_SCORE_ADJUSTMENT, positiveFeatures, riskFeatures, features,
    message: status === 'active'
      ? `已根据 ${samples.length} 条明确结果校准候选评分，单个候选最多调整 ±${FEEDBACK_MAX_SCORE_ADJUSTMENT} 分。`
      : `已有 ${samples.length} 条明确结果，但细分特征样本仍不足，暂不调整候选评分。`,
  }
}

export const applyAcquisitionFeedback = (model: AcquisitionFeedbackModel, candidate: DiscoveredCandidate) => {
  if (model.status !== 'active') return { candidate, adjustment: 0, matchedFeatures: [] as AcquisitionFeedbackFeature[] }
  const featureMap = new Map(model.features.map(feature => [feature.key, feature]))
  const matches = sampleFeatures(candidate).map(feature => featureMap.get(feature.key)).filter((feature): feature is AcquisitionFeedbackFeature => Boolean(feature))
  const strongestByKind = [...new Set(matches.map(feature => feature.kind))].map(kind => matches.filter(feature => feature.kind === kind).sort((a, b) => Math.abs(b.adjustment) - Math.abs(a.adjustment))[0])
  const adjustment = strongestByKind.length
    ? Math.round(clamp(strongestByKind.reduce((sum, feature) => sum + feature.adjustment, 0) / Math.sqrt(strongestByKind.length), -FEEDBACK_MAX_SCORE_ADJUSTMENT, FEEDBACK_MAX_SCORE_ADJUSTMENT))
    : 0
  if (!adjustment) return { candidate, adjustment: 0, matchedFeatures: strongestByKind }
  const dimensions = [...candidate.dimensions.filter(item => item.label !== '结果反馈校准'), { label: '结果反馈校准', score: clamp(50 + adjustment * 5, 0, 100) }]
  const explanation = strongestByKind.map(feature => `${feature.label}${feature.adjustment > 0 ? '+' : ''}${feature.adjustment}`).join('、')
  return {
    adjustment,
    matchedFeatures: strongestByKind,
    candidate: {
      ...candidate,
      score: clamp(candidate.score + adjustment, 0, 98),
      reason: `${candidate.reason}；历史结果反馈校准 ${adjustment > 0 ? '+' : ''}${adjustment} 分（${explanation}）。`,
      dimensions,
    },
  }
}

export const getAcquisitionFeedbackLearning = async (input: { workspaceId: string; planId: string; days?: number; useSnapshot?: boolean }) => {
  const plan = await db.$first(db.select({ id: acquisitionPlans.id, name: acquisitionPlans.name }).from(acquisitionPlans).where(and(
    eq(acquisitionPlans.workspaceId, input.workspaceId), eq(acquisitionPlans.id, input.planId),
  )))
  if (!plan) return null
  const days = clamp(input.days ?? 90, 30, 180)
  if (input.useSnapshot !== false) {
    const governed = await db.$first(db.select().from(learningSnapshots).where(and(
      eq(learningSnapshots.workspaceId, input.workspaceId), eq(learningSnapshots.planId, input.planId),
      sql`${learningSnapshots.status} in ('active','frozen')`,
    )).orderBy(desc(learningSnapshots.activatedAt), desc(learningSnapshots.createdAt)))
    if (governed) {
      try {
        const saved = JSON.parse(governed.modelJson) as AcquisitionFeedbackModel & { periodDays?: number }
        return { planId: plan.id, planName: plan.name, periodDays: saved.periodDays ?? days, ...saved }
      } catch { /* fall through to live model */ }
    }
  }
  const since = Date.now() - days * 86_400_000
  const taskRows = await db.select({ id: radarTasks.id }).from(radarTasks).where(and(
    eq(radarTasks.workspaceId, input.workspaceId), eq(radarTasks.acquisitionPlanId, plan.id), gte(radarTasks.createdAt, since),
  ))
  const taskIds = taskRows.map(row => row.id)
  const candidates = taskIds.length ? await db.select().from(radarCandidates).where(and(
    eq(radarCandidates.workspaceId, input.workspaceId), inArray(radarCandidates.radarTaskId, taskIds), gte(radarCandidates.discoveredAt, since),
  )) : []
  const customerRows = candidates.length ? await db.select().from(customers).where(eq(customers.workspaceId, input.workspaceId)) : []
  const customerByCompany = new Map(customerRows.map(customer => [normalizeCompany(customer.company), customer]))
  const customerIds = [...new Set(customerRows.map(customer => customer.id))]
  const threadRows = customerIds.length ? await db.select().from(messageThreads).where(and(
    eq(messageThreads.workspaceId, input.workspaceId), inArray(messageThreads.customerId, customerIds), gte(messageThreads.updatedAt, since),
  )) : []
  const dealRows = customerIds.length ? await db.select().from(deals).where(and(
    eq(deals.workspaceId, input.workspaceId), inArray(deals.customerId, customerIds), gte(deals.createdAt, since),
  )) : []
  const outcomeRows = customerIds.length ? await db.select().from(customerOutcomes).where(and(
    eq(customerOutcomes.workspaceId, input.workspaceId), inArray(customerOutcomes.customerId, customerIds), gte(customerOutcomes.occurredAt, since),
  )) : []
  const threadsByCustomer = new Map<string, typeof threadRows>()
  for (const thread of threadRows) if (thread.customerId) threadsByCustomer.set(thread.customerId, [...(threadsByCustomer.get(thread.customerId) ?? []), thread])
  const dealCustomerIds = new Set(dealRows.filter(deal => deal.stage !== '输单').map(deal => deal.customerId).filter((id): id is string => Boolean(id)))
  const explicitByCustomer = new Map<string, typeof outcomeRows[number]>()
  for (const outcome of [...outcomeRows].sort((a, b) => b.occurredAt - a.occurredAt)) if (outcome.customerId && !explicitByCustomer.has(outcome.customerId)) explicitByCustomer.set(outcome.customerId, outcome)
  const samples = candidates.flatMap((candidate): AcquisitionFeedbackSample[] => {
    const customer = customerByCompany.get(normalizeCompany(candidate.company))
    const threads = customer ? threadsByCustomer.get(customer.id) ?? [] : []
    const explicit = customer ? explicitByCustomer.get(customer.id) : undefined
    const positiveOutcomes = new Set(['replied_high_intent', 'qualified', 'won'])
    const negativeOutcomes = new Set(['disqualified', 'lost', 'unsubscribed', 'bounced'])
    const positive = explicit ? positiveOutcomes.has(explicit.outcome) : Boolean(customer && (dealCustomerIds.has(customer.id) || customer.stage === '有商机' || customer.stage === '已成交' || threads.some(thread => thread.intent === '高意向')))
    const negative = explicit ? negativeOutcomes.has(explicit.outcome) : candidate.status === 'rejected' || Boolean(customer && (/退订|暂无意向|不感兴趣/.test(customer.interaction) || customer.stage === '已流失' || threads.some(thread => thread.status === 'closed' && thread.intent !== '高意向' && thread.lastInboundAt)))
    if (!positive && !negative) return []
    return [{ outcome: positive ? 'positive' : 'negative', source: candidate.source, industry: candidate.industry, region: candidate.region, signal: candidate.signal }]
  })
  return { planId: plan.id, planName: plan.name, periodDays: days, ...buildAcquisitionFeedbackModel(samples) }
}
