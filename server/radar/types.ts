export type RadarTaskContext = {
  id: string
  workspaceId: string
  name: string
  icp: string
  mode: string
  strategy?: string
  dataSources?: string[]
  intentSignals?: string[]
  depth: string
  candidateLimit: number
  targetRegion: string
  researchLanguage: string
  seedUrls: string[]
}

export const RADAR_DATA_SOURCES = ['search', 'map', 'website', 'industry-directory', 'trade-show', 'procurement', 'seed-list'] as const
export type RadarDataSource = typeof RADAR_DATA_SOURCES[number]

export const effectiveRadarDataSources = (task: Pick<RadarTaskContext, 'mode' | 'dataSources' | 'seedUrls'>): RadarDataSource[] => {
  if (task.dataSources?.length) return task.dataSources.filter((value): value is RadarDataSource => RADAR_DATA_SOURCES.includes(value as RadarDataSource))
  if (/地图找客/.test(task.mode)) return ['map']
  if (/企业官网/.test(task.mode)) return ['website']
  if (/行业名录/.test(task.mode)) return ['industry-directory']
  if (/展会协会/.test(task.mode)) return ['trade-show']
  if (/招投标项目/.test(task.mode)) return ['procurement']
  if (/种子名单/.test(task.mode)) return ['seed-list']
  if (/搜索引擎|招聘扩产|新闻融资|贸易海关|社交网络/.test(task.mode)) return ['search']
  return ['search', 'map', 'industry-directory', 'trade-show', 'procurement', ...(task.seedUrls.length ? ['website' as const] : [])]
}

export type DiscoveredCandidate = {
  company: string
  region: string
  industry: string
  size: string
  score: number
  signal: string
  source: string
  estimatedValue: number
  currency: 'CNY' | 'EUR' | 'USD'
  confidence: number
  reason: string
  dimensions: { label: string; score: number }[]
  evidence: { title: string; source: string; time: string; strength: '强' | '中' | '弱'; sourceUrl: string }[]
  committee: { name: string; role: string; influence: string; contact: string }[]
  relationships: { label: string; value: string }[]
}

type ConnectorProgress = (message: string, progress: number) => void

export interface DiscoveryConnector {
  id: string
  label: string
  supports(task: RadarTaskContext): boolean | Promise<boolean>
  discover(task: RadarTaskContext, onProgress: ConnectorProgress): Promise<DiscoveredCandidate[]>
}

export class ConnectorError extends Error {
  retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'ConnectorError'
    this.retryable = retryable
  }
}
