import { discoverPlacesWorkspace, hasMapConfiguration, type LocalPlaceResult } from '../../integrations/map-client.js'
import { ConnectorError, effectiveRadarDataSources, type DiscoveryConnector, type DiscoveredCandidate, type RadarTaskContext } from '../types.js'

const coordinates = (place: LocalPlaceResult) => place.latitude === null || place.longitude === null
  ? ''
  : `${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}`

const scorePlace = (place: LocalPlaceResult) => Math.min(92,
  62 + (place.address ? 7 : 0) + (place.website ? 9 : 0) + (place.phone ? 5 : 0) + (coordinates(place) ? 5 : 0) + (place.businessStatus ? 3 : 0),
)

const mapCandidate = (task: RadarTaskContext, place: LocalPlaceResult): DiscoveredCandidate => {
  const confidence = Math.min(92, 58 + (place.externalId ? 8 : 0) + (place.address ? 8 : 0) + (coordinates(place) ? 7 : 0) + (place.website ? 7 : 0))
  const score = scorePlace(place)
  const relationships = [
    place.website ? { label: '企业官网', value: place.website } : null,
    place.address ? { label: '地图地址', value: place.address } : null,
    coordinates(place) ? { label: '地图坐标', value: coordinates(place) } : null,
    place.phone ? { label: '公开电话', value: place.phone } : null,
    place.externalId ? { label: '地点标识', value: place.externalId } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item))
  const summary = [place.address && `地址：${place.address}`, place.categories.length && `类型：${place.categories.slice(0, 3).join('、')}`, place.phone && '包含公开联系电话', place.website && '包含企业官网'].filter(Boolean).join('；')
  return {
    company: place.name,
    region: place.address || task.targetRegion || '待补全',
    industry: place.categories[0] || task.icp,
    size: '待补全',
    score,
    signal: '地图企业地点可验证',
    source: `${place.source} · 地图找客`,
    estimatedValue: 0,
    currency: 'CNY',
    confidence,
    reason: summary || '已从地图地点服务发现企业记录，行业、规模和购买信号仍需进一步研究。',
    dimensions: [
      { label: '定位相关度', score: Math.min(88, score) },
      { label: '地点可信度', score: confidence },
      { label: '购买时机', score: 35 },
      { label: '资料完整度', score: Math.min(90, 42 + relationships.length * 10) },
    ],
    evidence: [{ title: `${place.name} 地图地点记录`, source: place.source, time: new Date().toISOString(), strength: place.website ? '中' : '弱', sourceUrl: place.sourceUrl }],
    committee: [{ name: '待补全', role: '采购或技术负责人', influence: '待判断', contact: place.phone || '待验证' }],
    relationships,
  }
}

export class MapDiscoveryConnector implements DiscoveryConnector {
  id = 'map-discovery'
  label = '地图与本地企业发现'

  async supports(task: RadarTaskContext) {
    return effectiveRadarDataSources(task).includes('map') && (await hasMapConfiguration(task.workspaceId))
  }

  async discover(task: RadarTaskContext, onProgress: (message: string, progress: number) => void): Promise<DiscoveredCandidate[]> {
    onProgress('正在地图中查找本地企业', 10)
    const query = [task.icp, '企业 工厂 公司'].filter(Boolean).join(' ')
    try {
      const result = await discoverPlacesWorkspace(task.workspaceId, query, task.targetRegion, task.candidateLimit)
      onProgress(`地图发现 ${result.items.length} 家待研究企业`, 78)
      return result.items.map(place => mapCandidate(task, place))
    } catch (cause) {
      throw new ConnectorError(cause instanceof Error ? cause.message : '地图数据源调用失败', true)
    }
  }
}
