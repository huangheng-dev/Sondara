import { toInternationalSearchText } from './market-targeting.js'
import type { DiscoveredCandidate, RadarTaskContext } from './types.js'

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))
const PLACEHOLDER = /^(?:待补全|待验证|待识别|未知|其他|仅官网可验证|)$/i
const EXPLICIT_MISMATCH = /(?:不匹配|不符合|无关|非目标客户|不属于目标|无法确认.*匹配|insufficient evidence|not (?:a )?match|unrelated|outside (?:the )?target)/i
const ROLE_TERMS = new Set([
  'buyer', 'buyers', 'procurement', 'purchasing', 'distributor', 'distributors', 'reseller', 'resellers',
  'representative', 'representatives', 'integrator', 'integrators', 'contractor', 'contractors', 'epc',
  'manufacturer', 'manufacturers', 'factory', 'factories', 'plant', 'plants', 'operator', 'operators',
  '经销商', '分销商', '代理商', '采购商', '采购', '系统集成商', '集成商', '工程公司', '承包商', '设备制造商', '制造商', '终端工厂',
])
const STOP_TERMS = new Set([
  'and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'their', 'company', 'companies', 'business',
  'customer', 'customers', 'target', 'market', 'markets', 'global', 'overseas', 'international', 'official', 'website',
  'solution', 'solutions', 'service', 'services', 'industry', 'industries', 'equipment', 'system', 'systems', 'process',
  '公司', '企业', '客户', '目标', '市场', '全球', '海外', '国际', '官网', '行业', '设备', '系统', '解决方案',
])

const normalize = (value: string) => value.toLocaleLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ').trim()

const meaningfulTerms = (icp: string) => {
  const translated = toInternationalSearchText(icp)
  const ascii = `${icp} ${translated}`.toLocaleLowerCase().match(/[a-z][a-z0-9+&./'-]{2,}/g) ?? []
  const chinese = icp.match(/[\u3400-\u9fff]{2,8}/g) ?? []
  const chineseTerms = chinese.flatMap(segment => {
    if (segment.length <= 4) return [segment]
    const grams: string[] = []
    for (let size = 2; size <= Math.min(4, segment.length); size += 1) {
      for (let index = 0; index <= segment.length - size; index += 1) grams.push(segment.slice(index, index + size))
    }
    return grams
  })
  return [...new Set([...ascii, ...chineseTerms].map(normalize).filter(term => term.length >= 2 && !STOP_TERMS.has(term)))].slice(0, 48)
}

const candidateText = (candidate: DiscoveredCandidate) => normalize([
  candidate.industry, candidate.signal, candidate.reason, candidate.source,
  ...candidate.evidence.flatMap(item => [item.title, item.source]),
  ...candidate.relationships.flatMap(item => [item.label, item.value]),
].filter(Boolean).join(' '))

const matchedTerms = (terms: string[], text: string) => terms.filter(term => text.includes(term))

const dimensionScore = (candidate: DiscoveredCandidate, pattern: RegExp) => {
  const values = candidate.dimensions.filter(item => pattern.test(item.label)).map(item => item.score)
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
}

const requestedRoles = (task: Pick<RadarTaskContext, 'icp' | 'strategy'>) => {
  const text = normalize(`${task.icp} ${task.strategy ?? ''}`)
  return [...ROLE_TERMS].filter(term => text.includes(term))
}

const evidenceScore = (candidate: DiscoveredCandidate) => {
  const usable = candidate.evidence.filter(item => {
    try { return Boolean(item.sourceUrl && ['http:', 'https:'].includes(new URL(item.sourceUrl).protocol)) } catch { return false }
  })
  const strong = usable.filter(item => item.strength === '强').length
  const medium = usable.filter(item => item.strength === '中').length
  const hosts = new Set(usable.flatMap(item => { try { return [new URL(item.sourceUrl).hostname.replace(/^www\./, '')] } catch { return [] } }))
  const official = candidate.relationships.some(item => item.label === '企业官网' && /^https?:\/\//i.test(item.value))
  const sufficient = strong >= 1 || medium >= 2 || (official && usable.length >= 1)
  const score = clamp(35 + Math.min(30, strong * 22 + medium * 10) + (official ? 15 : 0) + (hosts.size >= 2 ? 10 : 0))
  return { score, sufficient, usable: usable.length, strong, medium, sources: hosts.size, official }
}

export type CandidateQualification = {
  allowed: boolean
  code: 'qualified' | 'entity_mismatch' | 'insufficient_evidence' | 'low_confidence' | 'application_mismatch' | 'role_mismatch' | 'low_quality'
  reason: string
  metrics: {
    qualificationScore: number
    applicationScore: number
    roleScore: number
    evidenceScore: number
    confidence: number
    matchedTerms: string[]
    evidenceCount: number
  }
  candidate: DiscoveredCandidate
}

/**
 * Evidence-first admission gate. A high connector or AI score alone never makes
 * a company qualified: the public evidence must support the requested use case,
 * business role and source quality independently.
 */
export const assessCandidateQualification = (
  task: Pick<RadarTaskContext, 'icp' | 'strategy' | 'targetRegion'>,
  candidate: DiscoveredCandidate,
  baselineEvidence?: DiscoveredCandidate,
): CandidateQualification => {
  // AI summaries are conclusions, not independent proof. During live research
  // lexical evidence is always measured against the pre-AI connector record.
  const evidenceCandidate = baselineEvidence ?? candidate
  const text = candidateText(evidenceCandidate)
  const terms = meaningfulTerms(task.icp)
  const matches = matchedTerms(terms, text)
  const roles = requestedRoles(task)
  const roleMatches = roles.filter(role => text.includes(role))
  const evidence = evidenceScore(candidate)
  const aiApplication = dimensionScore(candidate, /(?:产品应用|应用场景|目标客户|定位相关|ICP|业务匹配)/i)
  const aiRole = dimensionScore(candidate, /(?:企业角色|客户角色|采购角色|渠道角色)/i)
  const lexicalCoverage = terms.length ? matches.length / Math.min(terms.length, 12) : 0
  const measuredLexicalApplication = clamp(28 + matches.length * 12 + lexicalCoverage * 35)
  const persistedIndependentScore = dimensionScore(candidate, /独立证据匹配度/i)
  const lexicalApplication = baselineEvidence
    ? measuredLexicalApplication
    : persistedIndependentScore ?? (/AI 研究/.test(candidate.source) ? 0 : measuredLexicalApplication)
  const applicationScore = aiApplication === null
    ? lexicalApplication
    : Math.round(aiApplication * 0.72 + lexicalApplication * 0.28)
  const roleScore = roles.length === 0
    ? (aiRole ?? 75)
    : aiRole === null
      ? (roleMatches.length ? 88 : 32)
      : Math.round(aiRole * 0.75 + (roleMatches.length ? 90 : 35) * 0.25)
  const positioning = dimensionScore(candidate, /(?:目标客户|定位相关|ICP|业务匹配)/i) ?? applicationScore
  const qualificationScore = Math.round(
    applicationScore * 0.38 + roleScore * 0.22 + evidence.score * 0.22 + candidate.confidence * 0.18,
  )
  const calibratedScore = clamp(Math.round(qualificationScore * 0.7 + Math.min(candidate.score, qualificationScore + 8) * 0.3))
  const dimensions = [
    ...candidate.dimensions.filter(item => !/^(?:独立证据匹配度|产品应用匹配度|企业角色匹配度|证据充分度|准入综合分)$/.test(item.label)),
    { label: '独立证据匹配度', score: lexicalApplication },
    { label: '产品应用匹配度', score: applicationScore },
    { label: '企业角色匹配度', score: roleScore },
    { label: '证据充分度', score: evidence.score },
    { label: '准入综合分', score: qualificationScore },
  ]
  const updated = { ...candidate, score: calibratedScore, dimensions }
  const metrics = { qualificationScore, applicationScore, roleScore, evidenceScore: evidence.score, confidence: candidate.confidence, matchedTerms: matches.slice(0, 12), evidenceCount: evidence.usable }
  const result = (allowed: boolean, code: CandidateQualification['code'], reason: string): CandidateQualification => ({ allowed, code, reason, metrics, candidate: updated })

  if (EXPLICIT_MISMATCH.test(`${candidate.reason} ${candidate.industry}`)) return result(false, 'entity_mismatch', '公开研究结论包含明确的不匹配信息')
  if (!evidence.sufficient) return result(false, 'insufficient_evidence', '缺少企业官网、强证据或至少两条独立中等证据')
  if (candidate.confidence < 65) return result(false, 'low_confidence', `证据置信度 ${candidate.confidence}，低于 65 分准入线`)
  if (lexicalApplication < 52 || applicationScore < 65 || positioning < 65 || (PLACEHOLDER.test(candidate.industry) && matches.length < 2)) {
    return result(false, 'application_mismatch', `产品与应用匹配度 ${applicationScore}，未达到 65 分硬门槛`)
  }
  if (roles.length > 0 && roleScore < 60) return result(false, 'role_mismatch', `企业角色匹配度 ${roleScore}，没有证据表明其属于目标客户角色`)
  if (qualificationScore < 70 || calibratedScore < 68) return result(false, 'low_quality', `准入综合分 ${qualificationScore}，未达到 70 分`)
  return result(true, 'qualified', `已通过产品应用、企业角色、证据和置信度四项准入门槛`)
}
