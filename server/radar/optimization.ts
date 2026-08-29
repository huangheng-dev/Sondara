import type { DiscoveryConnector } from './types.js'

export type SourcePerformanceInput = {
  source: string
  candidates: number
  highMatch: number
  promoted: number
  outreach: number
  replies: number
}

export type SourcePriority = SourcePerformanceInput & {
  priorityScore: number
  priority: '优先' | '标准' | '探索'
}

const round = (value: number) => Math.round(value * 10) / 10

export const scoreSourcePerformance = (source: SourcePerformanceInput) => {
  const qualification = (source.promoted + 1) / (source.candidates + 4)
  const highMatch = (source.highMatch + 1) / (source.candidates + 4)
  const reply = (source.replies + 1) / (source.outreach + 10)
  const observedQuality = qualification * 45 + highMatch * 25 + reply * 30
  const confidence = Math.min(1, (source.candidates + source.outreach) / 30)
  return round(50 * (1 - confidence) + observedQuality * confidence)
}

export const prioritizeSources = <T extends SourcePerformanceInput>(sources: T[]): Array<T & Pick<SourcePriority, 'priorityScore' | 'priority'>> => sources
  .map(source => {
    const priorityScore = scoreSourcePerformance(source)
    return {
      ...source,
      priorityScore,
      priority: priorityScore >= 58 ? '优先' as const : priorityScore < 42 ? '探索' as const : '标准' as const,
    }
  })
  .sort((a, b) => b.priorityScore - a.priorityScore || b.candidates - a.candidates)

const connectorSourcePatterns: Record<string, RegExp[]> = {
  'map-discovery': [/地图|本地企业/],
  'search-discovery': [/搜索|公开网络|新闻|招聘|社交|贸易供应链/],
  'industry-source': [/行业目录|展会|协会|招投标|采购公告/],
  'website-seed': [/企业官网|种子名单/],
}

const connectorScore = (connector: DiscoveryConnector, sources: SourcePriority[]) => {
  const patterns = connectorSourcePatterns[connector.id] ?? []
  const matches = sources.filter(source => patterns.some(pattern => pattern.test(source.source)))
  if (!matches.length) return 50
  const sample = matches.reduce((sum, source) => sum + source.candidates + source.outreach, 0)
  return matches.reduce((sum, source) => sum + source.priorityScore * (source.candidates + source.outreach + 1), 0) / (sample + matches.length)
}

export const rankDiscoveryConnectors = (connectors: DiscoveryConnector[], sources: SourcePriority[]) => connectors
  .map((connector, index) => ({ connector, index, score: connectorScore(connector, sources) }))
  .sort((a, b) => b.score - a.score || a.index - b.index)
  .map(item => item.connector)
