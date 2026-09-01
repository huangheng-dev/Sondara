import type { DiscoveredCandidate, RadarTaskContext } from './types.js'

type Market = {
  key: string
  label: string
  english: string
  aliases: string[]
  tlds: string[]
  searchMarket: string
  countryCode: string
  groups: string[]
}

const MARKETS: Market[] = [
  { key: 'de', label: '德国', english: 'Germany', aliases: ['deutschland', 'germany', '德国'], tlds: ['.de'], searchMarket: 'de-DE', countryCode: 'DE', groups: ['europe', 'global'] },
  { key: 'gb', label: '英国', english: 'United Kingdom', aliases: ['united kingdom', 'great britain', 'england', 'uk', '英国'], tlds: ['.uk'], searchMarket: 'en-GB', countryCode: 'GB', groups: ['europe', 'global'] },
  { key: 'fr', label: '法国', english: 'France', aliases: ['france', 'français', '法国'], tlds: ['.fr'], searchMarket: 'fr-FR', countryCode: 'FR', groups: ['europe', 'global'] },
  { key: 'it', label: '意大利', english: 'Italy', aliases: ['italy', 'italia', '意大利'], tlds: ['.it'], searchMarket: 'it-IT', countryCode: 'IT', groups: ['europe', 'global'] },
  { key: 'es', label: '西班牙', english: 'Spain', aliases: ['spain', 'españa', '西班牙'], tlds: ['.es'], searchMarket: 'es-ES', countryCode: 'ES', groups: ['europe', 'global'] },
  { key: 'nl', label: '荷兰', english: 'Netherlands', aliases: ['netherlands', 'holland', 'nederland', '荷兰'], tlds: ['.nl'], searchMarket: 'nl-NL', countryCode: 'NL', groups: ['europe', 'global'] },
  { key: 'be', label: '比利时', english: 'Belgium', aliases: ['belgium', 'belgië', 'belgique', '比利时'], tlds: ['.be'], searchMarket: 'nl-BE', countryCode: 'BE', groups: ['europe', 'global'] },
  { key: 'pl', label: '波兰', english: 'Poland', aliases: ['poland', 'polska', '波兰'], tlds: ['.pl'], searchMarket: 'pl-PL', countryCode: 'PL', groups: ['europe', 'global'] },
  { key: 'us', label: '美国', english: 'United States', aliases: ['united states', 'united states of america', 'usa', 'u.s.a.', '美国'], tlds: ['.us'], searchMarket: 'en-US', countryCode: 'US', groups: ['north-america', 'global'] },
  { key: 'ca', label: '加拿大', english: 'Canada', aliases: ['canada', '加拿大'], tlds: ['.ca'], searchMarket: 'en-CA', countryCode: 'CA', groups: ['north-america', 'global'] },
  { key: 'mx', label: '墨西哥', english: 'Mexico', aliases: ['mexico', 'méxico', '墨西哥'], tlds: ['.mx'], searchMarket: 'es-MX', countryCode: 'MX', groups: ['north-america', 'latin-america', 'global'] },
  { key: 'br', label: '巴西', english: 'Brazil', aliases: ['brazil', 'brasil', '巴西'], tlds: ['.br'], searchMarket: 'pt-BR', countryCode: 'BR', groups: ['latin-america', 'global'] },
  { key: 'ae', label: '阿联酋', english: 'United Arab Emirates', aliases: ['united arab emirates', 'uae', 'dubai', 'abu dhabi', '阿联酋', '迪拜'], tlds: ['.ae'], searchMarket: 'en-AE', countryCode: 'AE', groups: ['middle-east', 'global'] },
  { key: 'sa', label: '沙特阿拉伯', english: 'Saudi Arabia', aliases: ['saudi arabia', 'ksa', '沙特'], tlds: ['.sa'], searchMarket: 'en-SA', countryCode: 'SA', groups: ['middle-east', 'global'] },
  { key: 'sg', label: '新加坡', english: 'Singapore', aliases: ['singapore', '新加坡'], tlds: ['.sg'], searchMarket: 'en-SG', countryCode: 'SG', groups: ['southeast-asia', 'global'] },
  { key: 'my', label: '马来西亚', english: 'Malaysia', aliases: ['malaysia', '马来西亚'], tlds: ['.my'], searchMarket: 'en-MY', countryCode: 'MY', groups: ['southeast-asia', 'global'] },
  { key: 'th', label: '泰国', english: 'Thailand', aliases: ['thailand', '泰国'], tlds: ['.th'], searchMarket: 'en-TH', countryCode: 'TH', groups: ['southeast-asia', 'global'] },
  { key: 'id', label: '印度尼西亚', english: 'Indonesia', aliases: ['indonesia', '印度尼西亚', '印尼'], tlds: ['.id'], searchMarket: 'en-ID', countryCode: 'ID', groups: ['southeast-asia', 'global'] },
  { key: 'vn', label: '越南', english: 'Vietnam', aliases: ['vietnam', 'viet nam', '越南'], tlds: ['.vn'], searchMarket: 'en-VN', countryCode: 'VN', groups: ['southeast-asia', 'global'] },
  { key: 'in', label: '印度', english: 'India', aliases: ['india', '印度'], tlds: ['.in'], searchMarket: 'en-IN', countryCode: 'IN', groups: ['asia', 'global'] },
  { key: 'jp', label: '日本', english: 'Japan', aliases: ['japan', '日本'], tlds: ['.jp'], searchMarket: 'ja-JP', countryCode: 'JP', groups: ['asia', 'global'] },
  { key: 'kr', label: '韩国', english: 'South Korea', aliases: ['south korea', 'republic of korea', 'korea', '韩国'], tlds: ['.kr'], searchMarket: 'ko-KR', countryCode: 'KR', groups: ['asia', 'global'] },
  { key: 'au', label: '澳大利亚', english: 'Australia', aliases: ['australia', '澳大利亚', '澳洲'], tlds: ['.au'], searchMarket: 'en-AU', countryCode: 'AU', groups: ['oceania', 'global'] },
  { key: 'nz', label: '新西兰', english: 'New Zealand', aliases: ['new zealand', '新西兰'], tlds: ['.nz'], searchMarket: 'en-NZ', countryCode: 'NZ', groups: ['oceania', 'global'] },
  { key: 'za', label: '南非', english: 'South Africa', aliases: ['south africa', '南非'], tlds: ['.za'], searchMarket: 'en-ZA', countryCode: 'ZA', groups: ['africa', 'global'] },
]

const GROUP_ALIASES: Record<string, RegExp> = {
  global: /(?:全球|海外|国际|global|worldwide|overseas)/i,
  europe: /(?:欧洲|europe|eu market)/i,
  'north-america': /(?:北美|north america)/i,
  'middle-east': /(?:中东|middle east|gcc)/i,
  'southeast-asia': /(?:东南亚|southeast asia|asean)/i,
  'latin-america': /(?:拉丁美洲|拉美|latin america)/i,
  asia: /(?:亚洲|asia)/i,
  oceania: /(?:大洋洲|oceania)/i,
  africa: /(?:非洲|africa)/i,
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const containsAlias = (text: string, alias: string) => /[\u4e00-\u9fff]/.test(alias)
  ? text.toLowerCase().includes(alias.toLowerCase())
  : new RegExp(`(?:^|[^a-z])${escapeRegExp(alias)}(?:$|[^a-z])`, 'i').test(text)

const explicitMarket = (value: string) => MARKETS.find(market => market.aliases.some(alias => containsAlias(value, alias)))
const targetGroup = (value: string) => Object.entries(GROUP_ALIASES).find(([, pattern]) => pattern.test(value))?.[0]

export const overseasMarketOptions = [
  '全球海外市场（自动轮换国家）', '欧洲（自动轮换国家）', '北美（自动轮换国家）', '中东（自动轮换国家）',
  '东南亚（自动轮换国家）', '拉丁美洲（自动轮换国家）', '亚洲（自动轮换国家）', '大洋洲（自动轮换国家）', '非洲（自动轮换国家）',
]

export const isOverseasTarget = (value: string) => Boolean(targetGroup(value) || explicitMarket(value)) && !/(?:中国|china|mainland)/i.test(value)

export const resolveRunTargetRegion = (value: string, runNumber: number) => {
  const direct = explicitMarket(value)
  if (direct) return `${direct.label}（${direct.english}）`
  const group = targetGroup(value)
  if (!group) return value
  const choices = MARKETS.filter(market => market.groups.includes(group))
  const selected = choices[(Math.max(1, runNumber) - 1) % choices.length]
  return selected ? `${selected.label}（${selected.english}）` : value
}

export const getTargetMarket = (value: string) => explicitMarket(value)

export const getSearchLocale = (value: string) => {
  const market = explicitMarket(value)
  return market ? { market: market.searchMarket, countryCode: market.countryCode, language: 'en' } : { market: 'en-US', countryCode: 'US', language: 'en' }
}

const ICP_TRANSLATIONS: Array<[RegExp, string]> = [
  [/高洁净|卫生级|无菌/g, 'hygienic aseptic high-purity'], [/制药|医药/g, 'pharmaceutical'], [/食品|饮料/g, 'food beverage'],
  [/乳品|乳制品/g, 'dairy'], [/酿酒|啤酒/g, 'brewery'], [/半导体/g, 'semiconductor'], [/新能源/g, 'new energy'],
  [/精细化工|化工/g, 'specialty chemical'], [/水处理/g, 'water treatment'], [/终端工厂/g, 'end-user plant'],
  [/设备制造商/g, 'equipment manufacturer'], [/系统集成商/g, 'system integrator'], [/经销商|分销商/g, 'distributor'],
  [/代理商/g, 'representative'], [/工程公司|工程客户/g, 'engineering contractor'], [/阀门/g, 'valve'], [/泵/g, 'pump'],
]

export const toInternationalSearchText = (value: string) => {
  let translated = value
  for (const [pattern, replacement] of ICP_TRANSLATIONS) translated = translated.replace(pattern, ` ${replacement} `)
  const english = translated.match(/[a-z][a-z0-9+&./'-]*(?:\s+[a-z][a-z0-9+&./'-]*){0,5}/gi) ?? []
  return [...new Set(english.map(item => item.trim()).filter(item => item.length > 2))].join(' ').replace(/\s+/g, ' ').trim() || value
}

const CHINA_SIGNAL = /(?:中国大陆|中国|mainland china|people'?s republic of china|\bprc\b|\+86\b|北京市|上海市|天津市|重庆市|广东省|浙江省|江苏省|山东省|河北省|河南省|湖北省|湖南省|福建省|安徽省|四川省|陕西省|山西省|辽宁省|吉林省|黑龙江省|江西省|贵州省|云南省|甘肃省|青海省|海南省|内蒙古|新疆|西藏|宁夏|广西|包头市)/i

const urlsFromCandidate = (candidate: DiscoveredCandidate) => [
  ...candidate.evidence.map(item => item.sourceUrl),
  ...candidate.relationships.map(item => item.value),
].filter(value => /^https?:\/\//i.test(value))

const marketFromUrl = (rawUrl: string) => {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'cn' || host.endsWith('.cn')) return 'china' as const
    return MARKETS.find(market => market.tlds.some(tld => host.endsWith(tld)))
  } catch { return undefined }
}

export const isChineseSourceUrl = (rawUrl: string) => marketFromUrl(rawUrl) === 'china'

export const inferMarketFromEvidence = (text: string, urls: string[] = []) => {
  if (CHINA_SIGNAL.test(text) || urls.some(isChineseSourceUrl)) return { country: 'china' as const, basis: '公开信息指向中国大陆' }
  for (const url of urls) {
    const market = marketFromUrl(url)
    if (market && market !== 'china') return { country: market, basis: `国家域名 ${market.tlds[0]}` }
  }
  const market = MARKETS.find(item => item.aliases.some(alias => containsAlias(text, alias)))
  return market ? { country: market, basis: '官网、地址或公开资料中的国家信息' } : null
}

export const inferCandidateMarket = (candidate: DiscoveredCandidate) => {
  const evidenceText = [candidate.region, candidate.company, candidate.reason, candidate.source, candidate.signal, candidate.industry, ...candidate.relationships.flatMap(item => [item.label, item.value])].join(' ')
  return inferMarketFromEvidence(evidenceText, urlsFromCandidate(candidate))
}

export type CandidateGeographyAssessment =
  | { allowed: true; candidate: DiscoveredCandidate; basis?: string }
  | { allowed: false; reason: string }

export const assessCandidateGeography = (task: Pick<RadarTaskContext, 'targetRegion' | 'researchLanguage'>, candidate: DiscoveredCandidate): CandidateGeographyAssessment => {
  if (!isOverseasTarget(`${task.targetRegion} ${task.researchLanguage}`)) return { allowed: true, candidate }
  const inferred = inferCandidateMarket(candidate)
  if (!inferred) return { allowed: false, reason: '无法从官网、地址或国家域名验证所在国家' }
  if (inferred.country === 'china') return { allowed: false, reason: inferred.basis }
  const expected = explicitMarket(task.targetRegion)
  if (expected && inferred.country.key !== expected.key) return { allowed: false, reason: `目标市场为${expected.label}，公开信息指向${inferred.country.label}` }
  const group = targetGroup(task.targetRegion)
  if (group && !inferred.country.groups.includes(group)) return { allowed: false, reason: `公开信息指向${inferred.country.label}，不属于本轮目标市场` }
  return { allowed: true, candidate: { ...candidate, region: `${inferred.country.label}（${inferred.country.english}）` }, basis: inferred.basis }
}

export const overseasSearchExclusions = '-China -Chinese -PRC -site:.cn -Alibaba -Made-in-China -1688 -directory -magazine -marketplace -jobs -recruitment'
