export type RadarTaskContext = {
  id: string
  workspaceId: string
  name: string
  icp: string
  mode: string
  depth: string
  candidateLimit: number
  targetRegion: string
  researchLanguage: string
  seedUrls: string[]
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
