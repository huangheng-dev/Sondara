export const OVERSEAS_MARKET = /(?:海外|全球|国际|global|worldwide|overseas|north america|europe|usa|u\.s\.|united states|southeast asia|middle east|英语|english|en-us|en\b)/i

export const isOverseasMarket = (task: { targetRegion?: string; researchLanguage?: string }) =>
  OVERSEAS_MARKET.test(`${task.targetRegion ?? ''} ${task.researchLanguage ?? ''}`)

export const isLikelyOverseasProspect = (input: { company?: string; title?: string; description?: string; reason?: string; source?: string; url?: string; industry?: string; signal?: string; icp?: string }) => {
  const identityText = [input.company, input.title, input.industry, input.signal, input.source, input.url].filter(Boolean).join(' ').toLowerCase()
  const text = [identityText, input.reason].filter(Boolean).join(' ').toLowerCase()
  const nonCompanySignal = /\b(?:association|federation|chamber|institute|university|college|government|ministry|directory|magazine|news(?:letter)?|press release|blog|exhibition|trade fair|conference|job(s| board)?|recruitment|staffing|employment|marketplace|wholesale platform|verband|verein|mitglied(?:er)?|membership|members)\b/.test(text)
  if (nonCompanySignal) return false

  const domainSignal = /pharma|biotech|bioengineering|bioprocess|bioprocessing|biopharma|sterile|sterilization|sterilisation|aseptic|hygienic|sanitary|high[- ]?purity|cip\b|\bsip\b|pure steam|clean steam|process plant|process equipment|process system|process solution|process automation|process engineering|plant engineering|cleaning in place|steam in place|life sciences|pharmaceutical manufacturing|fill-finish|fill finish|bioreactor|fermentation|formulation|purified water|water system|utility systems|flow control|fluid solution|skid|pharmaanlagenbau|prozessanlage|skidbau|reinstdampf|biotechnik|lebensmittel|dairy|brewery|beverage|semiconductor|wet[- ]?process/.test(text)
  const routeSignal = /distributor|distributors|representative|reseller|sales partner|channel partner|system integrator|integrator|contractor|engineering partner|turnkey|equipment supplier/.test(text)
  const nonCustomerSignal = /market access|commercialization|pharmaceutical distributor|pharma distributor|medicine distributor|wholesaler|consulting|regulatory affairs|clinical(?: trials)?|healthcare service|marketing agency|business accelerator|sales accelerator/.test(text)
  const competitorSignal = /(?:china|chinese)\s+(?:manufacturer|supplier|factory)|manufacturer in china|made in china|factory in china/.test(text)
  const productCompetitor = /\b(?:sanitary|hygienic|high[- ]?purity)?\s*(?:valves?|pumps?|fittings?|tubing|couplings?)\s+manufacturer|manufacturer\s+(?:and\s+supplier\s+of\s+)?(?:reliable\s+)?(?:valves?|pumps?|fittings?|tubing|couplings?)\b/i.test(identityText)
  const productMakerSignal = /(?:safety valve|sampling valve|diaphragm valve|ball valve|butterfly valve|control valve|sanitary valves?|hygienic valves?|pumps? and valves?|valve technology|valve company|valve group|the[\s-]+safety[\s-]+valve|阀门制造商|阀门供应商|泵阀|阀门公司)/i.test(identityText)
  const researchSignal = /market research|research report|business research|industry report|market report|press release|news article|recruitment|staffing|employment agency|job seekers|hiring|talent|b2b marketplace|wholesale platform|companies and suppliers|find companies now|directory of companies/.test(text)
  const icpTerms = (input.icp?.toLowerCase().match(/[a-z0-9][a-z0-9+-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [])
    .filter(term => !/^(?:and|the|for|with|company|companies|business|customer|customers|target|market|global|official|website|公司|企业|客户|市场|目标)$/.test(term))
  const icpSignal = icpTerms.some(term => identityText.includes(term))
  if (researchSignal) return false
  if ((productCompetitor || productMakerSignal) && !routeSignal) return false
  if (competitorSignal && !routeSignal) return false
  return domainSignal || routeSignal || icpSignal
}

const CHINA_COMPANY_PATTERN = /(?:公司|工厂|研究院|设计院|研究所|集团|有限|股份)/
const CHINA_LOCATION_PATTERN = /(?:中国|中华人民共和国|中国大陆|北京|上海|广东|广州|深圳|浙江|杭州|宁波|温州|江苏|南京|苏州|无锡|山东|青岛|济南|福建|厦门|河北|河南|湖北|武汉|湖南|四川|成都|重庆|天津|安徽|合肥|辽宁|大连|陕西|西安)/
const CHINA_SUPPLIER_PATTERN = /(?:china|chinese|中国|中文)[\s\S]{0,50}(?:manufacturer|supplier|factory|vendor|wholesale|制造商|供应商|工厂)|(?:manufacturer|supplier|factory)[\s\S]{0,50}(?:in china|china|中国)/i

const candidateUrls = (candidate: { relationships?: { label: string; value: string }[]; evidence?: { sourceUrl?: string }[] }) => {
  const urls = [
    ...(candidate.relationships ?? []).map(item => item.value),
    ...(candidate.evidence ?? []).map(item => item.sourceUrl ?? ''),
  ].filter(Boolean)
  return urls
}

export const isChineseDomesticProspect = (candidate: {
  company?: string
  region?: string
  industry?: string
  signal?: string
  source?: string
  reason?: string
  relationships?: { label: string; value: string }[]
  evidence?: { title?: string; source?: string; sourceUrl?: string }[]
}) => {
  const text = [
    candidate.company,
    candidate.region,
    candidate.industry,
    candidate.signal,
    candidate.source,
    candidate.reason,
    ...(candidate.evidence ?? []).flatMap(item => [item.title, item.source]),
  ].filter(Boolean).join(' ')

  if (CHINA_COMPANY_PATTERN.test(candidate.company ?? '')) return true
  const locationText = [candidate.company, candidate.region].filter(Boolean).join(' ')
  if (CHINA_LOCATION_PATTERN.test(locationText)) return true
  if (/\b(?:china|prc|people'?s republic of china)\b/i.test(locationText)) return true
  if (CHINA_SUPPLIER_PATTERN.test(text)) return true

  for (const value of candidateUrls(candidate)) {
    try {
      const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '')
      if (host === 'cn' || host.endsWith('.cn') || host.endsWith('.com.cn') || host.endsWith('.net.cn') || host.endsWith('.org.cn')) return true
    } catch {
      // ignore malformed evidence links
    }
  }
  return false
}

export const isExportOverseasProspect = (candidate: Parameters<typeof isChineseDomesticProspect>[0]) =>
  !isChineseDomesticProspect(candidate)
