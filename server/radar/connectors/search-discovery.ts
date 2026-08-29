import { hasSearchConfiguration, searchWorkspace, type SearchResult } from '../../integrations/search-client.js'
import { WebsiteSeedConnector } from './website-seed.js'
import { ConnectorError, effectiveRadarDataSources, type DiscoveryConnector, type DiscoveredCandidate, type RadarTaskContext } from '../types.js'
import { isExcludedHost } from './host-blocklist.js'
import { isLikelyOverseasProspect } from './prospect-quality.js'

const NON_COMPANY_TITLE = /^(?:首页|主页|登录|注册|搜索结果|新闻|资讯|视频|图片|地图|问答|下载|文档|帮助|关于|联系|产品列表|分类|标签|404|页面不存在|login|sign in|register|search results|news|videos|images|maps|download|docs|help|contact|about|products|categories|tags)$/i

const NON_COMPANY_HOST = /(?:linkedin\.com|facebook\.com|x\.com|twitter\.com|youtube\.com|youtu\.be|instagram\.com|wikipedia\.org|wikidata\.org|gov|reddit\.com)$/i

const targetTerms = (task: Pick<RadarTaskContext, 'icp' | 'targetRegion'>) =>
  `${task.icp} ${task.targetRegion}`
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9+-]{2,}|[\u4e00-\u9fff]{2,6}/g)
    ?.filter(term => !/^(?:company|companies|business|customer|customers|target|market|global|official|website|全球|公司|企业|客户|市场|目标|项目)$/.test(term))
    .slice(0, 12) ?? []

const resultScore = (item: { title: string; url: string; description: string }, task: Pick<RadarTaskContext, 'icp' | 'targetRegion'>) => {
  const text = [item.title, item.description, item.url].join(' ').toLowerCase()
  let score = 0
  score += Math.min(16, targetTerms(task).filter(term => text.includes(term)).length * 4)
  if (/manufacturer|supplier|provider|vendor|distributor|representative|reseller|partner|integrator|contractor|operator|owner|procurement|consulting|software|platform|制造|供应|服务商|经销|代理|合作伙伴|集成|承包|业主|采购|咨询|软件/.test(text)) score += 10
  if (/association|federation|chamber|verband|verein|membership|directory|news|magazine|exhibition|marketplace|job board/.test(text)) score -= 20
  return score
}

const looksLikeCompanySite = (item: { title: string; url: string; description: string }, icp: string) => {
  try {
    const url = new URL(item.url)
    if (isExcludedHost(url.hostname)) return false
    if (NON_COMPANY_HOST.test(url.hostname)) return false
    if (/\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|tar|gz)$/i.test(url.pathname)) return false
    if (/\/(?:login|signup|register|cart|search|tag|category|blog\/tag)\/?$/i.test(url.pathname)) return false
    const title = item.title.trim()
    if (title.length < 3) return false
    if (NON_COMPANY_TITLE.test(title)) return false
    return isLikelyOverseasProspect({ company: title, title, description: item.description, reason: item.description, url: item.url, icp })
  } catch {
    return false
  }
}

const officialRoots = (items: { url: string }[]) => {
  const seen = new Set<string>()
  const roots: string[] = []
  for (const item of items) {
    try {
      const url = new URL(item.url)
      if (isExcludedHost(url.hostname)) continue
      if (/\.(pdf|docx?|xlsx?|pptx?|zip)$/i.test(url.pathname)) continue
      const root = `${url.protocol}//${url.host}/`
      if (!seen.has(root)) { seen.add(root); roots.push(root) }
    } catch { /* ignore malformed URL */ }
  }
  return roots
}

export class SearchDiscoveryConnector implements DiscoveryConnector {
  id = 'search-discovery'
  label = '搜索发现'

  async supports(task: RadarTaskContext) {
    return effectiveRadarDataSources(task).includes('search') && (await hasSearchConfiguration(task.workspaceId))
  }

  async discover(task: RadarTaskContext, onProgress: (message: string, progress: number) => void): Promise<DiscoveredCandidate[]> {
    onProgress('正在搜索目标企业官网', 8)
    const exclusions = '-directory -magazine -marketplace -jobs -recruitment'
    const keywordExpression = targetTerms(task).slice(0, 8).map(term => `"${term}"`).join(' OR ')
    const selectedSignals = (task.intentSignals ?? []).join(' ')
    const signalSearch = /招聘|扩张|新建|产能/.test(selectedSignals)
      ? '(hiring OR careers OR recruitment OR "new production line" OR expansion OR "new facility")'
      : /新闻|融资|并购|经营动态/.test(selectedSignals)
        ? '(funding OR investment OR acquisition OR expansion OR "new facility" OR partnership)'
        : /贸易|供应链|采购关系/.test(selectedSignals)
          ? '(importer OR exporter OR import OR export OR procurement OR "supply chain" OR distributor)'
          : /关键岗位|社交|管理层/.test(selectedSignals)
            ? '(LinkedIn OR "company profile" OR "sales director" OR "business development")'
            : ''
    const signalQueries = signalSearch ? [[task.icp, task.targetRegion, signalSearch, 'official website', exclusions].filter(Boolean).join(' ')] : []
    const strategyExpression = /经销|代理|合作伙伴|渠道/.test(task.strategy ?? '')
      ? '(distributor OR reseller OR representative OR "channel partner" OR integrator)'
      : /采购|招标|项目/.test(task.strategy ?? '')
        ? '(procurement OR purchasing OR tender OR buyer OR project)'
        : '(company OR manufacturer OR supplier OR provider OR operator)'
    const queries = [...signalQueries,
      [
        task.icp,
        task.targetRegion,
        keywordExpression ? `(${keywordExpression})` : '',
        strategyExpression,
        'official website', exclusions,
      ].filter(Boolean).join(' '),
      [
        task.icp,
        task.targetRegion,
        '(supplier OR vendor OR provider OR buyer OR procurement OR partner)',
        'official website', exclusions,
      ].filter(Boolean).join(' '),
      [
        task.icp,
        task.targetRegion,
        '(distributor OR representative OR "sales partner" OR "channel partner" OR contractor OR "turnkey" OR integrator)',
        'official website', exclusions,
      ].filter(Boolean).join(' '),
    ]
    const itemMap = new Map<string, SearchResult>()
    let queryIndex = 0
    for (const query of queries) {
      queryIndex += 1
      try {
        const search = await searchWorkspace(task.workspaceId, query, Math.min(20, Math.max(task.candidateLimit * 5, 10)))
        for (const item of search.items) itemMap.set(item.url, item)
        onProgress(`第 ${queryIndex}/${queries.length} 组搜索完成，累计 ${itemMap.size} 条结果`, 10 + queryIndex * 4)
      } catch (cause) {
        throw new ConnectorError(cause instanceof Error ? cause.message : '搜索数据源调用失败', true)
      }
    }
    const search: { items: SearchResult[] } = { items: [...itemMap.values()] }
    const companyItems = search.items
      .filter(item => looksLikeCompanySite(item, task.icp))
      .sort((a, b) => resultScore(b, task) - resultScore(a, task))
    onProgress(`搜索到 ${search.items.length} 条结果，筛选出 ${companyItems.length} 个相关企业官网`, 24)
    const urls = officialRoots(companyItems).slice(0, Math.min(20, Math.max(task.candidateLimit * 3, 12)))
    if (!urls.length) return []
    const website = new WebsiteSeedConnector()
    const candidates = await website.discover({ ...task, candidateLimit: Math.min(urls.length, Math.max(task.candidateLimit * 3, 12)), seedUrls: urls }, (message, progress) => onProgress(message, 24 + Math.round(progress * 0.66)))
    const resultsByHost = new Map(search.items.map(item => { try { return [new URL(item.url).hostname.replace(/^www\./, ''), item] as const } catch { return ['', item] as const } }))
    return candidates
      .map(candidate => {
        const websiteUrl = candidate.relationships.find(item => item.label === '企业官网')?.value ?? ''
        let match: typeof search.items[number] | undefined
        try { match = resultsByHost.get(new URL(websiteUrl).hostname.replace(/^www\./, '')) } catch { /* keep homepage-only evidence */ }
        return { candidate, match }
      })
      .filter(({ candidate, match }) => isLikelyOverseasProspect({
        company: candidate.company,
        title: match?.title,
        description: match?.description,
        reason: candidate.reason,
        source: match?.source,
        url: match?.url,
        icp: task.icp,
      }))
      .map(({ candidate, match }) => ({
        ...candidate,
        source: `${task.mode === '招聘扩产' ? '招聘扩产信号' : task.mode === '新闻融资' ? '新闻融资信号' : task.mode === '贸易海关' ? '贸易供应链信号' : task.mode === '社交网络' ? '社交公开信号' : '搜索发现'} · ${candidate.source}`,
        signal: task.mode === '招聘扩产' ? '招聘或扩产信号待核验' : task.mode === '新闻融资' ? '新闻或资本动态待核验' : task.mode === '贸易海关' ? '贸易与供应链关系待核验' : task.mode === '社交网络' ? '公开社交与关键岗位信号待核验' : candidate.signal,
        reason: match?.description ? `搜索摘要：${match.description.slice(0, 240)}；${candidate.reason}` : candidate.reason,
        evidence: match ? [...candidate.evidence, { title: match.title, source: match.source, time: new Date().toISOString(), strength: '弱' as const, sourceUrl: match.url }] : candidate.evidence,
      }))
  }
}
