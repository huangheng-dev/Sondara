import type { DiscoveryConnector, DiscoveredCandidate, RadarTaskContext } from '../types.js'
import { ConnectorError, effectiveRadarDataSources } from '../types.js'
import { assertSafeOutboundUrl, UnsafeUrlError } from '../../lib/url-safety.js'
import { config } from '../../config.js'

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_REDIRECTS = 3

const assertPublicUrl = async (rawUrl: string) => {
  try { return await assertSafeOutboundUrl(rawUrl, { allowPrivate: config.allowPrivateConnectors, label: '官网地址' }) }
  catch (cause) { if (cause instanceof UnsafeUrlError) throw new ConnectorError(cause.message, cause.retryable); throw cause }
}

const charsetFromContentType = (contentType: string) => {
  const match = /charset=([^;\s]+)/i.exec(contentType)
  return match?.[1]?.trim().toLowerCase().replace(/^["']|["']$/g, '') || ''
}

const charsetFromHtml = (head: string) => {
  const meta = head.match(/<meta[^>]+charset=["']?\s*([a-z0-9._-]+)/i)
  return meta?.[1]?.trim().toLowerCase() || ''
}

const decodeHtml = (buffer: Buffer, contentType: string) => {
  const sniff = buffer.subarray(0, 4096).toString('latin1')
  const charset = charsetFromContentType(contentType) || charsetFromHtml(sniff) || 'utf-8'
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer)
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buffer)
  }
}

export const fetchPublicPage = async (rawUrl: string) => {
  let url = await assertPublicUrl(rawUrl)
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response: Response
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(12_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; SondaraDiscovery/0.1; +self-hosted customer research)' },
      })
    } catch {
      throw new ConnectorError(`官网访问失败：${url.hostname}`, true)
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new ConnectorError(`官网重定向缺少目标地址：${url.hostname}`)
      url = await assertPublicUrl(new URL(location, url).toString())
      continue
    }
    if (!response.ok) throw new ConnectorError(`官网返回 HTTP ${response.status}：${url.hostname}`, response.status >= 500 || response.status === 429)
    const contentLength = Number(response.headers.get('content-length') ?? 0)
    if (contentLength > MAX_RESPONSE_BYTES) throw new ConnectorError(`官网页面超过 2MB 限制：${url.hostname}`)
    const contentType = response.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) throw new ConnectorError(`官网首页不是 HTML 页面：${url.hostname}`)
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_RESPONSE_BYTES) throw new ConnectorError(`官网页面超过 2MB 限制：${url.hostname}`)
    const html = decodeHtml(buffer, contentType)
    return { url, html }
  }
  throw new ConnectorError(`官网重定向次数过多：${url.hostname}`)
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  times: '×', divide: '÷', deg: '°', micro: 'µ',
}

const decodeEntities = (value: string) => value
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
    try { return String.fromCodePoint(parseInt(hex, 16)) } catch { return '' }
  })
  .replace(/&#(\d+);/g, (_, decimal: string) => {
    try { return String.fromCodePoint(Number(decimal)) } catch { return '' }
  })
  .replace(/&([a-z]+);/gi, (match, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
  .replace(/\s+/g, ' ')
  .trim()

const metaContent = (html: string, key: string) => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i'),
  ]
  for (const pattern of patterns) { const match = html.match(pattern); if (match?.[1]) return decodeEntities(match[1]) }
  return ''
}

const pageTitle = (html: string) => decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '') ?? '')

const visiblePageText = (html: string) => decodeEntities(html
  .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .slice(0, 12_000)

const researchLinks = (html: string, baseUrl: URL) => {
  const selected = new Map<string, number>()
  const relevant = /(?:about|company|profile|products?|solutions?|services?|industr(?:y|ies)|applications?|capabilities|projects?|cases?|customers?|contact|关于|公司|产品|解决方案|服务|行业|应用|能力|项目|案例|客户|联系)/i
  const deny = /(?:privacy|terms|cookie|login|register|cart|checkout|careers?|jobs?|news|blog|download|隐私|条款|登录|注册|购物|招聘|新闻)/i
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[1] ?? '')
    const label = decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, ' '))
    if (!relevant.test(`${href} ${label}`) || deny.test(`${href} ${label}`)) continue
    try {
      const url = new URL(href, baseUrl)
      if (!['http:', 'https:'].includes(url.protocol) || url.hostname.replace(/^www\./, '') !== baseUrl.hostname.replace(/^www\./, '')) continue
      url.hash = ''
      const normalized = url.toString()
      const score = /(?:products?|solutions?|services?|capabilities|产品|解决方案|服务|能力)/i.test(`${href} ${label}`) ? 3
        : /(?:about|company|profile|关于|公司)/i.test(`${href} ${label}`) ? 2 : 1
      selected.set(normalized, Math.max(selected.get(normalized) ?? 0, score))
    } catch { /* ignore malformed links */ }
  }
  return [...selected.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url).slice(0, 3)
}

const NAV_NOISE = /^(?:首页|主页|网站首页|公司新闻|公司通讯|新闻中心|企业新闻|产品中心|产品展示|解决方案|关于我们|联系我们|联系方式|人才招聘|招贤纳士|服务支持|售后|下载中心|english|登录|注册|home|about|contact|products|news)$/i
const COPYRIGHT_PREFIX = /^(?:版权所有|copyright)\s*(?:©|&copy;|\(c\))?\s*/i
const ARTICLE_LIKE = /(?:本文|指南|报价|清单|参数|对比|附录|附件|如何|怎么|怎样|方案|白皮书|新闻|资讯|专题|深度|报道|流程|步骤|排名|哪家好|哪个品牌|选购|知识|问答|百科|视频|图片|下载|手册|说明书|标准|规范)/
const GENERIC_PATTERNS = [
  /(?:服务商|解决方案|生产厂家|厂家|供应商|制造商|批发商|代理商|经销商|官网|网站|平台|系统|设备|产品中心|公司新闻|联系我们|关于我们|首页|主页)/,
  /^(?:skip to content|skip navigation|main menu|menu|home|about(?: us)?|contact(?: us)?|products?|view products|download catalogs?|catalogs?|solutions|services|industries?|applications?|blog|news|support|search|login|register|cart|sanitary products|instrumentation products|uhp products|event details|news details|view details|details|learn more|read more|show more|media partners|photo galleries|newsletter|demographics summary|exhibitor showcase schedule|schedule|agenda|events?|careers|resources|attendees?|exhibitors?|speakers?|sessions?|venue|travel|hotels?|sponsors?|partners|register|visit|floor plan|restaurant recommendations|why attend)$/i,
  /\b(?:manufacturer|supplier|distributor|integrator|representative|wholesale|factory|process equipment|flow control|official website)\b/i,
  /\b(?:project management software|company honor)\b/i,
  /^(?:leading|global|international|professional|top|best)\s+(?:epc|engineering|construction|company|contractor|supplier)/i,
  /^(?:工程建设|工程设计|设备制造|工业设备)?公司$/,
]
const isGenericName = (name: string) => GENERIC_PATTERNS.some(pattern => pattern.test(name))
const COMPANY_SUFFIX = /(?:股份有限公司|有限责任公司|集团有限公司|有限公司|集团|工厂|研究院|设计院|研究所|公司|\b(?:Ltd\.?|Limited|GmbH|AG|Inc\.?|Corp\.?|Corporation|LLC|Co\.?|Company|S\.A\.?|S\.r\.l\.?|B\.V\.?|Oy|OÜ)\b)\s*$/i
const PERSON_ROLE_NOISE = /(?:负责人|总经理|经理|总监|主管|分析师|研究员|职员|工程师|教授|主席|董事|顾问)/

export const normalizeCompanyName = (value: string) => decodeEntities(value)
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(COPYRIGHT_PREFIX, '')
  .replace(/^[\s|｜·•\-–—_]+|[\s|｜·•\-–—_]+$/g, '')
  .trim()
  .slice(0, 160)

export const isLikelyCompanyName = (value: string) => {
  const name = normalizeCompanyName(value)
  if (name.length < 4 || name.length > 60) return false
  if (NAV_NOISE.test(name) || ARTICLE_LIKE.test(name) || PERSON_ROLE_NOISE.test(name)) return false
  if (isGenericName(name)) return false
  if (COMPANY_SUFFIX.test(name)) return true
  return /^[A-Z][A-Za-z0-9.&'-]+(?:\s+[A-Z][A-Za-z0-9.&'-]+){0,3}$/.test(name)
}

const jsonLdOrgName = (html: string) => {
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const visit = (node: unknown): string => {
        if (Array.isArray(node)) { for (const item of node) { const found = visit(item); if (found) return found } return '' }
        if (!node || typeof node !== 'object') return ''
        const item = node as Record<string, unknown>
        if (item['@graph']) { const found = visit(item['@graph']); if (found) return found }
        const rawType = item['@type']
        const types = Array.isArray(rawType) ? rawType.map(String) : [String(rawType ?? '')]
        if (types.some(t => /Organization|Corporation|LocalBusiness|Manufacturer|Company/i.test(t)) && typeof item.name === 'string') {
          return item.name.trim()
        }
        return ''
      }
      const found = visit(JSON.parse(match[1]))
      if (found) return normalizeCompanyName(found)
    } catch { /* ignore invalid JSON-LD */ }
  }
  return ''
}

const companyName = (html: string, url: URL) => {
  const structured = jsonLdOrgName(html)
  if (isLikelyCompanyName(structured)) return normalizeCompanyName(structured)
  const siteName = metaContent(html, 'og:site_name') || metaContent(html, 'application-name')
  if (isLikelyCompanyName(siteName)) return normalizeCompanyName(siteName)

  const rawTitle = pageTitle(html)
  const candidate = rawTitle
    .split(/\s*[|｜–—_·•-]\s*/)
    .map(segment => normalizeCompanyName(segment))
    .filter(isLikelyCompanyName)
    .sort((a, b) => {
      const score = (name: string) => (COMPANY_SUFFIX.test(name) ? 100 : 0) + (/[\u4e00-\u9fff]/.test(name) ? 15 : 0) - Math.abs(name.length - 16)
      return score(b) - score(a)
    })[0]

  if (candidate) return candidate
  const fallback = url.hostname.replace(/^www\./, '').split('.')[0].replace(/[-_]+/g, ' ').trim()
  return fallback.replace(/\b\w/g, letter => letter.toUpperCase())
}

const BUYING_SIGNAL_TERMS = [
  '采购', '招标', '询价', '供应商', '经销商', '代理商', '合作伙伴', '项目', '扩建', '新工厂', '新办公室',
  'request for quotation', 'rfq', 'procurement', 'purchasing', 'supplier', 'vendor registration', 'tender', 'bid',
  'distributor', 'reseller', 'representative', 'partner program', 'project', 'expansion', 'new facility', 'new office',
]

const scoreWebsite = (task: RadarTaskContext, text: string, secure: boolean) => {
  const lower = text.toLowerCase()
  const taskText = task.icp.toLowerCase()
  const bigrams = new Set<string>()
  for (let i = 0; i < taskText.length - 1; i += 1) {
    const gram = taskText.slice(i, i + 2)
    if (/[\u4e00-\u9fff]{2}/.test(gram)) bigrams.add(gram)
  }
  const asciiTerms = taskText.match(/[a-z0-9][a-z0-9._-]{2,}/gi) ?? []
  const bigramHits = [...bigrams].filter(g => lower.includes(g)).length
  const asciiHits = asciiTerms.filter(t => lower.includes(t)).length
  const highSignalHits = BUYING_SIGNAL_TERMS.filter(t => lower.includes(t.toLowerCase())).length
  const score = 45 + Math.min(bigramHits * 3, 24) + Math.min(asciiHits * 5, 16) + Math.min(highSignalHits * 6, 24) + (secure ? 4 : 0)
  return Math.min(95, Math.round(score))
}

export class WebsiteSeedConnector implements DiscoveryConnector {
  id = 'website-seed'
  label = '官网种子发现'

  supports(task: RadarTaskContext) { return task.seedUrls.length > 0 && effectiveRadarDataSources(task).some(source => source === 'website' || source === 'seed-list') }

  async discover(task: RadarTaskContext, onProgress: (message: string, progress: number) => void): Promise<DiscoveredCandidate[]> {
    const urls = [...new Set(task.seedUrls)].slice(0, task.candidateLimit)
    const results: DiscoveredCandidate[] = []
    const errors: string[] = []
    for (const [index, rawUrl] of urls.entries()) {
      onProgress(`正在验证官网 ${index + 1}/${urls.length}`, 15 + Math.round(index / Math.max(urls.length, 1) * 65))
      try {
        const { url, html } = await fetchPublicPage(rawUrl)
        const pages = [{ url, html }]
        for (const detailUrl of researchLinks(html, url)) {
          if (detailUrl === url.toString()) continue
          try { pages.push(await fetchPublicPage(detailUrl)) } catch { /* homepage evidence remains usable */ }
        }
        const name = companyName(html, url)
        const description = pages.map(page => metaContent(page.html, 'description') || metaContent(page.html, 'og:description')).find(Boolean) ?? ''
        const title = pageTitle(html)
        const researchText = pages.map(page => `${pageTitle(page.html)} ${metaContent(page.html, 'description')} ${visiblePageText(page.html)}`).join(' ')
        const score = scoreWebsite(task, researchText, url.protocol === 'https:')
        const confidence = Math.min(95, 58 + (title ? 8 : 0) + (description ? 12 : 0) + (url.protocol === 'https:' ? 5 : 0) + Math.min(12, (pages.length - 1) * 4))
        results.push({
          company: name,
          region: task.targetRegion || '待补全',
          industry: task.icp || '待补全',
          size: '待补全',
          score,
          signal: '官网公开页面可访问',
          source: '企业官网',
          estimatedValue: 0,
          currency: 'CNY',
          confidence,
          reason: description ? `已核验 ${pages.length} 个企业官网公开页面。官网描述：${description.slice(0, 260)}` : `已核验 ${pages.length} 个企业官网公开页面，行业、规模和购买信号仍需进一步研究。`,
          dimensions: [
            { label: '定位相关度', score },
            { label: '官网可信度', score: confidence },
            { label: '购买时机', score: 35 },
            { label: '资料完整度', score: Math.min(90, (description ? 68 : 45) + (pages.length - 1) * 7) },
          ],
          evidence: pages.map((page, pageIndex) => ({ title: pageTitle(page.html) || `${name} 官网${pageIndex ? '研究页面' : '首页'}`, source: page.url.hostname, time: new Date().toISOString(), strength: pageIndex === 0 ? '强' as const : '中' as const, sourceUrl: page.url.toString() })),
          committee: [{ name: '待补全', role: '采购或技术负责人', influence: '待判断', contact: '待验证' }],
          relationships: [{ label: '企业官网', value: url.toString() }],
        })
      } catch (cause) {
        errors.push(cause instanceof Error ? cause.message : `官网处理失败：${rawUrl}`)
      }
    }
    if (!results.length && errors.length) throw new ConnectorError(errors.join('；'), errors.some(message => /访问失败|无法解析|HTTP 5|HTTP 429/.test(message)))
    return results
  }
}
