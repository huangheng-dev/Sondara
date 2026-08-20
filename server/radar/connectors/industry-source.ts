import { hasSearchConfiguration, searchWorkspace, type SearchResult } from '../../integrations/search-client.js'
import { isExcludedHost } from './host-blocklist.js'
import { fetchPublicPage, normalizeCompanyName } from './website-seed.js'
import { isLikelyOverseasProspect, isOverseasMarket } from './prospect-quality.js'
import { ConnectorError, type DiscoveryConnector, type DiscoveredCandidate, type RadarTaskContext } from '../types.js'

type IndustryMode = '行业名录' | '展会协会' | '招投标项目'
type IndustryEntity = { name: string; url: string; region: string; evidenceTitle: string; extraction: 'structured' | 'page' | 'search' }

const modeMeta: Record<IndustryMode, { source: string; signal: string; query: string; evidence: string; baseScore: number }> = {
  行业名录: { source: '行业目录', signal: '进入公开行业名录', query: 'company directory manufacturers suppliers', evidence: '行业名录收录', baseScore: 72 },
  展会协会: { source: '展会协会', signal: '展商或协会会员身份', query: 'exhibitors members association directory', evidence: '展会或协会收录', baseScore: 76 },
  招投标项目: { source: '公开招投标', signal: '公开采购或中标信号', query: 'tender procurement award supplier contractor', evidence: '招投标公开记录', baseScore: 82 },
}

const cleanText = (value: string) => value.replace(/<script(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;/gi, "'").replace(/&quot;/gi, '"').replace(/\s+/g, ' ').trim()
const normalizeName = (value: string) => normalizeCompanyName(cleanText(value)).replace(/^[\s·•|–—-]+|[\s·•|–—-]+$/g, '').replace(/\s+(?:member|exhibitor|supplier|vendor|profile|company)\s*$/i, '').slice(0, 160)
const NAV_DENYLIST = /(?:公司新闻|公司通讯|公司简介|公司概况|新闻中心|产品中心|关于我们|联系我们|招贤纳士|人才招聘|服务支持|下载中心|解决方案|成功案例|资质荣誉|企业文化|发展历程|组织架构|营销网络|售后服务|常见问题|网站地图|法律声明|隐私政策|会员登录|用户注册|english|首页)/i
const ORGANIZATION_SUFFIX = /(?:有限公司|股份有限公司|有限责任公司|集团有限公司|集团|工厂|研究院|设计院|研究所|公司|\b(?:Ltd\.?|Limited|GmbH|AG|Inc\.?|Corp\.?|Corporation|LLC|Co\.?|Company|S\.A\.?|S\.r\.l\.?|B\.V\.?|Oy|OÜ)\b)/i
const organizationLike = (value: string) => {
  const name = normalizeName(value)
  if (name.length < 4 || name.length > 60 || NAV_DENYLIST.test(name)) return false
  return ORGANIZATION_SUFFIX.test(name)
}
const safeUrl = (value: unknown, pageUrl: URL) => {
  if (typeof value !== 'string' || !value.trim()) return ''
  try { const url = new URL(value, pageUrl); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '' } catch { return '' }
}
const addressLabel = (address: unknown) => {
  if (typeof address === 'string') return address.slice(0, 120)
  if (!address || typeof address !== 'object') return ''
  const item = address as Record<string, unknown>
  return [item.addressLocality, item.addressRegion, item.addressCountry].filter(value => typeof value === 'string' && value).join(' · ').slice(0, 120)
}

const structuredEntities = (html: string, pageUrl: URL, evidenceTitle: string) => {
  const entities: IndustryEntity[] = []
  const visit = (node: unknown) => {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!node || typeof node !== 'object') return
    const item = node as Record<string, unknown>
    if (item['@graph']) visit(item['@graph'])
    const rawType = item['@type']
    const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType ?? '')]
    if (types.some(type => /Organization|Corporation|LocalBusiness|Manufacturer|Store/i.test(type)) && typeof item.name === 'string') {
      const name = normalizeName(item.name)
      if (organizationLike(name)) entities.push({ name, url: safeUrl(item.url, pageUrl), region: addressLabel(item.address), evidenceTitle, extraction: 'structured' })
    }
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1])) } catch { /* ignore invalid structured data */ }
  }
  return entities
}

const pageEntities = (html: string, pageUrl: URL, mode: IndustryMode, evidenceTitle: string) => {
  const entities: IndustryEntity[] = []
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = normalizeName(match[2] ?? '')
    const href = match[1] ?? ''
    if (name.length < 4 || name.length > 60 || name.includes('@') || /^mailto:/i.test(href)) continue
    if (NAV_DENYLIST.test(name)) continue
    if (!organizationLike(name)) continue
    const url = safeUrl(href, pageUrl)
    entities.push({ name, url, region: '', evidenceTitle, extraction: 'page' })
  }
  if (mode === '招投标项目') {
    const text = cleanText(html)
    const patterns = [/(?:中标人|成交供应商|供应商名称|中选单位|投标人)\s*[:：]?\s*([^，。；;|]{3,100})/g, /(?:awardee|awarded to|successful bidder|supplier|contractor)\s*[:：-]?\s*([^.;|]{3,100})/gi]
    for (const pattern of patterns) for (const match of text.matchAll(pattern)) {
      const name = normalizeName(match[1].split(/(?:金额|地址|报价|项目|采购)/)[0])
      if (name.length >= 4 && organizationLike(name)) entities.push({ name, url: pageUrl.toString(), region: '', evidenceTitle, extraction: 'page' })
    }
  }
  return entities
}

export const extractIndustryEntities = (html: string, pageUrl: URL, mode: IndustryMode, evidenceTitle = '') => {
  const title = evidenceTitle || cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || pageUrl.hostname
  const combined = [...structuredEntities(html, pageUrl, title), ...pageEntities(html, pageUrl, mode, title)]
  const seen = new Set<string>()
  return combined.filter(item => {
    const key = item.name.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
    if (key.length < 2 || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const resultFallbackEntity = (result: SearchResult): IndustryEntity | null => {
  const name = result.title
    .split(/\s*[|｜–—_·•-]\s*/)
    .map(segment => normalizeName(segment))
    .filter(organizationLike)
    .sort((a, b) => b.length - a.length)[0] ?? ''
  if (!name) return null
  return { name, url: result.url, region: '', evidenceTitle: result.title, extraction: 'search' }
}

const modeList = (task: RadarTaskContext): IndustryMode[] => task.mode === '智能多渠道' ? ['行业名录', '展会协会', '招投标项目'] : [task.mode as IndustryMode]

export class IndustrySourceConnector implements DiscoveryConnector {
  id = 'industry-source'
  label = '行业与公开机会来源'

  supports(task: RadarTaskContext) {
    const explicit = /行业名录|展会协会|招投标项目/.test(task.mode)
    return (task.mode === '智能多渠道' && hasSearchConfiguration(task.workspaceId)) || (explicit && (hasSearchConfiguration(task.workspaceId) || task.seedUrls.length > 0))
  }

  async discover(task: RadarTaskContext, onProgress: (message: string, progress: number) => void): Promise<DiscoveredCandidate[]> {
    const modes = modeList(task)
    const pages = new Map<string, { mode: IndustryMode; result?: SearchResult }>()
    const errors: string[] = []
    const searchEnabled = hasSearchConfiguration(task.workspaceId)
    if (searchEnabled) {
      for (const [index, mode] of modes.entries()) {
        onProgress(`正在发现${mode}公开来源`, 10 + Math.round(index / modes.length * 22))
        try {
          const meta = modeMeta[mode]
          const query = [task.icp, task.targetRegion, meta.query].filter(Boolean).join(' ')
          const result = await searchWorkspace(task.workspaceId, query, Math.min(10, Math.max(4, Math.ceil(task.candidateLimit / modes.length))))
          result.items
            .filter(item => { try { return !isExcludedHost(new URL(item.url).hostname) } catch { return false } })
            .forEach(item => pages.set(item.url, { mode, result: item }))
        } catch (cause) { errors.push(cause instanceof Error ? cause.message : `${mode}搜索失败`) }
      }
    }
    if (task.mode !== '智能多渠道') task.seedUrls.forEach(url => pages.set(url, { mode: task.mode as IndustryMode }))
    const discovered: { entity: IndustryEntity; mode: IndustryMode; sourceUrl: string; sourceLabel: string }[] = []
    for (const [index, [sourceUrl, context]] of [...pages.entries()].slice(0, 18).entries()) {
      onProgress(`正在核验行业来源 ${index + 1}/${Math.min(pages.size, 18)}`, 34 + Math.round(index / Math.max(1, Math.min(pages.size, 18)) * 48))
      try {
        const page = await fetchPublicPage(sourceUrl)
        const entities = extractIndustryEntities(page.html, page.url, context.mode, context.result?.title)
        if (entities.length) entities.slice(0, 20).forEach(entity => discovered.push({ entity, mode: context.mode, sourceUrl: page.url.toString(), sourceLabel: context.result?.source ?? page.url.hostname }))
        else if (context.result) { const fallback = resultFallbackEntity(context.result); if (fallback) discovered.push({ entity: fallback, mode: context.mode, sourceUrl: context.result.url, sourceLabel: context.result.source }) }
      } catch (cause) { errors.push(cause instanceof Error ? cause.message : `行业来源访问失败：${sourceUrl}`) }
    }
    const seen = new Set<string>()
    const overseasMarket = isOverseasMarket(task)
    const candidates = discovered.filter(item => {
      const key = item.entity.name.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
      if (!key || seen.has(key)) return false
      seen.add(key)
      if (overseasMarket && !isLikelyOverseasProspect({ company: item.entity.name, title: item.entity.evidenceTitle, source: item.sourceLabel, reason: item.sourceLabel, url: item.sourceUrl, icp: task.icp })) return false
      return true
    }).slice(0, task.candidateLimit).map(({ entity, mode, sourceUrl, sourceLabel }): DiscoveredCandidate => {
      const meta = modeMeta[mode]
      const publicPage = entity.url || sourceUrl
      const sourceHost = (() => { try { return new URL(sourceUrl).hostname } catch { return sourceLabel } })()
      const confidence = Math.min(94, entity.extraction === 'structured' ? 86 : entity.extraction === 'page' ? 76 : 62)
      const score = Math.min(96, meta.baseScore + (entity.extraction === 'structured' ? 7 : 0) + (entity.url ? 4 : 0))
      return {
        company: entity.name,
        region: entity.region || task.targetRegion || '待补全',
        industry: task.icp,
        size: '待补全',
        score,
        signal: meta.signal,
        source: meta.source,
        estimatedValue: 0,
        currency: 'CNY',
        confidence,
        reason: `${meta.evidence}：${entity.evidenceTitle || sourceHost}。该信息来自公开页面，企业身份、项目阶段和采购窗口仍需人工复核。`,
        dimensions: [{ label: '定位相关度', score }, { label: '来源可信度', score: confidence }, { label: '机会时机', score: mode === '招投标项目' ? 82 : 58 }, { label: '资料完整度', score: entity.url ? 70 : 52 }],
        evidence: [{ title: entity.evidenceTitle || meta.evidence, source: `${meta.source} · ${sourceLabel}`, time: new Date().toISOString(), strength: entity.extraction === 'structured' ? '强' : entity.extraction === 'page' ? '中' : '弱', sourceUrl }],
        committee: [{ name: '待补全', role: '采购或项目负责人', influence: '待判断', contact: '待验证' }],
        relationships: [{ label: meta.source, value: sourceUrl }, ...(entity.url && entity.url !== sourceUrl ? [{ label: '企业公开页面', value: publicPage }] : [])],
      }
    })
    if (!candidates.length && errors.length && !pages.size) throw new ConnectorError(errors.join('；'), true)
    return candidates
  }
}
