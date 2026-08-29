const OVERSEAS_MARKET = /(?:海外|全球|国际|global|worldwide|overseas|north america|europe|usa|u\.s\.|united states|southeast asia|middle east|英语|english|en-us|en\b)/i

export const isOverseasMarket = (task: { targetRegion?: string; researchLanguage?: string }) =>
  OVERSEAS_MARKET.test(`${task.targetRegion ?? ''} ${task.researchLanguage ?? ''}`)

export const isLikelyOverseasProspect = (input: { company?: string; title?: string; description?: string; reason?: string; source?: string; url?: string; industry?: string; signal?: string; icp?: string }) => {
  const identityText = [input.company, input.title, input.industry, input.signal, input.source, input.url].filter(Boolean).join(' ').toLowerCase()
  const text = [identityText, input.reason].filter(Boolean).join(' ').toLowerCase()
  const nonCompanySignal = /\b(?:directory|magazine|news(?:letter)?|press release|blog|exhibition|trade fair|conference|job(s| board)?|recruitment platform|staffing agency|marketplace|wholesale platform|find companies|companies and suppliers)\b/.test(text)
  if (nonCompanySignal) return false

  const routeSignal = /manufacturer|supplier|provider|vendor|distributor|representative|reseller|partner|integrator|contractor|operator|owner|procurement|consulting|software|platform|hospital|clinic|school|university|government|agency|制造|供应|服务商|经销|代理|合作伙伴|集成|承包|业主|采购|咨询|软件|平台|医院|学校|政府/.test(text)
  const corporateSignal = /\b(?:inc|corp|corporation|company|co\.?|ltd|limited|llc|gmbh|ag|plc|sarl|s\.a\.|b\.v\.)\b|有限公司|股份|集团|公司|机构|中心|研究院/.test(identityText)
  const researchSignal = /market research|research report|business research|industry report|market report|press release|news article|recruitment|staffing|employment agency|job seekers|hiring|talent|b2b marketplace|wholesale platform|companies and suppliers|find companies now|directory of companies/.test(text)
  const icpTerms = (input.icp?.toLowerCase().match(/[a-z0-9][a-z0-9+-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [])
    .filter(term => !/^(?:and|the|for|with|company|companies|business|customer|customers|target|market|global|official|website|公司|企业|客户|市场|目标)$/.test(term))
  const icpSignal = icpTerms.some(term => identityText.includes(term))
  if (researchSignal) return false
  return routeSignal || corporateSignal || icpSignal
}
