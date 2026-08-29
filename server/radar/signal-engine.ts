import { db } from '../db/client.js'
import { companySignals } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import type { DiscoveredCandidate, RadarTaskContext } from './types.js'

type DetectedSignal = {
  signalType: string
  title: string
  summary: string
  source: string
  sourceUrl: string
  evidenceQuote: string
  scoreBoost: number
  observedAt: number
  expiresAt: number
}

const rules: Array<{ label: string; aliases: RegExp; evidence: RegExp; boost: number; validDays: number }> = [
  { label: '采购公告', aliases: /采购|招投标|tender|rfq|rfp|procurement/i, evidence: /采购|招标|投标|中标|询价|采购公告|tender|procurement|solicitation|request for (?:quotation|proposal|bid)|\brfq\b|\brfp\b/i, boost: 10, validDays: 120 },
  { label: '扩张建设', aliases: /扩张|建设|新工厂|expansion/i, evidence: /扩建|扩产|新建|开设|投产|工厂|园区|facility|factory|plant|expansion|new office|opening/i, boost: 8, validDays: 180 },
  { label: '招聘变化', aliases: /招聘|人才|hiring|job/i, evidence: /招聘|职位|人才|扩招|采购经理|job opening|hiring|career|vacanc|recruit/i, boost: 5, validDays: 90 },
  { label: '新闻融资', aliases: /新闻|融资|并购|funding|news/i, evidence: /融资|募资|并购|收购|投资|新产品|获奖|订单|funding|raised|acquisition|merger|investment|launch|contract awarded/i, boost: 6, validDays: 120 },
  { label: '管理层变更', aliases: /管理层|高管|leadership/i, evidence: /任命|上任|管理层|首席|总经理|appointed|new (?:ceo|cfo|cto)|leadership/i, boost: 4, validDays: 120 },
  { label: '技术栈变化', aliases: /技术栈|technology|stack/i, evidence: /迁移|部署|采用|技术栈|migrat|deploy|adopt|technology stack|platform/i, boost: 4, validDays: 120 },
]

const domainFrom = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return null } }

export const detectIntentSignals = (task: RadarTaskContext, candidate: DiscoveredCandidate) => {
  const selected = task.intentSignals ?? []
  if (!selected.length) return { candidate, signals: [] as DetectedSignal[] }
  const now = Date.now()
  const signals: DetectedSignal[] = []
  for (const rule of rules) {
    if (!selected.some(value => rule.aliases.test(value) || value === rule.label)) continue
    const evidence = candidate.evidence.find(item => rule.evidence.test(`${item.title} ${item.source}`))
    if (!evidence && !rule.evidence.test(`${candidate.signal} ${candidate.reason}`)) continue
    const selectedEvidence = evidence ?? candidate.evidence[0]
    if (!selectedEvidence?.sourceUrl) continue
    signals.push({
      signalType: rule.label,
      title: evidence?.title || `${candidate.company} 出现${rule.label}信号`,
      summary: `${candidate.company} 的公开证据符合“${rule.label}”规则，需人工打开来源确认时效和业务含义。`,
      source: selectedEvidence.source,
      sourceUrl: selectedEvidence.sourceUrl,
      evidenceQuote: selectedEvidence.title,
      scoreBoost: rule.boost,
      observedAt: now,
      expiresAt: now + rule.validDays * 86_400_000,
    })
  }
  if (!signals.length) return { candidate, signals }
  const totalBoost = Math.min(12, signals.reduce((sum, signal) => sum + signal.scoreBoost, 0))
  const signalLabels = [...new Set([candidate.signal, ...signals.map(signal => signal.signalType)].filter(Boolean))].join(' · ')
  const dimensions = [...candidate.dimensions.filter(item => item.label !== '意向信号'), { label: '意向信号', score: Math.min(100, 55 + totalBoost * 3) }]
  return { candidate: { ...candidate, score: Math.min(98, candidate.score + totalBoost), signal: signalLabels, dimensions }, signals }
}

export const storeCandidateSignals = async (input: { workspaceId: string; candidateId: string; company: string; signals: DetectedSignal[] }) => {
  if (!input.signals.length) return 0
  let stored = 0
  for (const signal of input.signals) {
    const result = await db.insert(companySignals).values({
      id: createId('sig'), workspaceId: input.workspaceId, customerId: null, candidateId: input.candidateId,
      company: input.company, domain: domainFrom(signal.sourceUrl), signalType: signal.signalType,
      title: signal.title.slice(0, 240), summary: signal.summary.slice(0, 1000), source: signal.source.slice(0, 160),
      sourceUrl: signal.sourceUrl, evidenceQuote: signal.evidenceQuote.slice(0, 500), scoreBoost: signal.scoreBoost,
      observedAt: signal.observedAt, expiresAt: signal.expiresAt, metadataJson: '{}', createdAt: Date.now(),
    }).onConflictDoNothing()
    stored += result.rowsAffected ?? 0
  }
  return stored
}
