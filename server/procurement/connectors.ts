import type { integrationConnections } from '../db/schema.js'
import { decryptSecret } from '../lib/secret-vault.js'

type Connection = typeof integrationConnections.$inferSelect

export type ProcurementQuery = {
  keywords: string[]
  regions: string[]
  noticeTypes: string[]
  limit: number
  postedFrom?: Date
  postedTo?: Date
}

export type ProcurementOpportunityInput = {
  provider: 'ted' | 'sam-gov' | 'ungm' | 'world-bank'
  externalId: string
  title: string
  buyer: string
  description: string
  country: string
  noticeType: string
  status: string
  publishedAt: number | null
  deadlineAt: number | null
  sourceUrl: string
  contact: Record<string, unknown>
  metadata: Record<string, unknown>
  relevanceScore: number
}

const secretFor = (connection: Connection | null) => {
  if (!connection?.secretCiphertext || !connection.secretIv || !connection.secretTag) return ''
  return decryptSecret({ ciphertext: connection.secretCiphertext, iv: connection.secretIv, tag: connection.secretTag })
}

const scalar = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const firstText = (value: unknown): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim()
  if (Array.isArray(value)) return value.map(firstText).find(Boolean) ?? ''
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return firstText(record.eng) || firstText(record.ENG) || Object.values(record).map(firstText).find(Boolean) || ''
  }
  return ''
}
const timestamp = (value: unknown) => {
  const text = scalar(value)
  if (!text) return null
  const parsed = Date.parse(text)
  return Number.isFinite(parsed) ? parsed : null
}
const keywordScore = (item: { title: string; description: string }, query: ProcurementQuery) => {
  if (!query.keywords.length) return 50
  const haystack = `${item.title} ${item.description}`.toLocaleLowerCase()
  const matches = query.keywords.filter(keyword => haystack.includes(keyword.toLocaleLowerCase())).length
  return Math.min(100, Math.round(35 + (matches / query.keywords.length) * 65))
}
const escapeTed = (value: string) => value.replace(/["\\]/g, '\\$&')
const dateForSam = (date: Date) => `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`

const readJson = async (response: Response, label: string) => {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const message = firstText(body.message) || firstText(body.error) || `${label} 返回 HTTP ${response.status}`
    throw new Error(message.replace(/([?&](?:api_key|token)=)[^&\s]+/gi, '$1[REDACTED]').slice(0, 500))
  }
  return body
}

export const fetchTedOpportunities = async (query: ProcurementQuery, fetchImpl: typeof fetch = fetch): Promise<ProcurementOpportunityInput[]> => {
  const keywords = query.keywords.slice(0, 8).map(keyword => `notice-title ~ "${escapeTed(keyword)}"`)
  const regions = query.regions.slice(0, 12).filter(region => /^[A-Z]{3}$/.test(region)).map(region => `place-of-performance IN (${region})`)
  const expertQuery = [keywords.length ? `(${keywords.join(' OR ')})` : '', regions.length ? `(${regions.join(' OR ')})` : ''].filter(Boolean).join(' AND ') || 'place-of-performance IN (LUX)'
  const response = await fetchImpl('https://api.ted.europa.eu/v3/notices/search', {
    method: 'POST',
    signal: AbortSignal.timeout(25_000),
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      query: expertQuery,
      fields: ['publication-number', 'notice-title', 'buyer-name', 'publication-date', 'deadline-receipt-tender-date-lot', 'place-of-performance-country-lot', 'notice-type'],
      page: 1,
      limit: Math.min(100, Math.max(1, query.limit)),
      scope: 'ACTIVE',
      checkQuerySyntax: false,
      paginationMode: 'PAGE_NUMBER',
      onlyLatestVersions: true,
    }),
  })
  const body = await readJson(response, 'TED Search API')
  if (body.timedOut === true) throw new Error('TED Search API 查询超时，请缩小关键词或地区范围。')
  const rows = Array.isArray(body.notices) ? body.notices as Record<string, unknown>[] : []
  return rows.map(row => {
    const externalId = scalar(row['publication-number'])
    const title = firstText(row['notice-title']) || `TED 公告 ${externalId}`
    const links = row.links as { html?: Record<string, string> } | undefined
    const sourceUrl = links?.html?.ENG || Object.values(links?.html ?? {})[0] || `https://ted.europa.eu/en/notice/-/detail/${encodeURIComponent(externalId)}`
    const item = {
      provider: 'ted' as const, externalId, title,
      buyer: firstText(row['buyer-name']) || '待确认采购方', description: '',
      country: firstText(row['place-of-performance-country-lot']) || '欧盟',
      noticeType: firstText(row['notice-type']) || '采购公告', status: 'active',
      publishedAt: timestamp(row['publication-date']), deadlineAt: timestamp(row['deadline-receipt-tender-date-lot']),
      sourceUrl, contact: {}, metadata: { expertQuery }, relevanceScore: 0,
    }
    return { ...item, relevanceScore: keywordScore(item, query) }
  }).filter(item => item.externalId && item.title)
}

export const fetchSamOpportunities = async (query: ProcurementQuery, connection: Connection | null, fetchImpl: typeof fetch = fetch): Promise<ProcurementOpportunityInput[]> => {
  const apiKey = secretFor(connection)
  if (!apiKey) throw new Error('SAM.gov 连接缺少 Public API Key。')
  const today = query.postedTo ?? new Date()
  const from = query.postedFrom ?? new Date(today.valueOf() - 30 * 86_400_000)
  const endpoint = new URL(connection?.endpoint || 'https://api.sam.gov/opportunities/v2/search')
  endpoint.searchParams.set('api_key', apiKey)
  endpoint.searchParams.set('postedFrom', dateForSam(from))
  endpoint.searchParams.set('postedTo', dateForSam(today))
  endpoint.searchParams.set('limit', String(Math.min(100, Math.max(1, query.limit))))
  endpoint.searchParams.set('offset', '0')
  if (query.keywords[0]) endpoint.searchParams.set('title', query.keywords[0])
  if (query.regions[0] && /^[A-Z]{2}$/.test(query.regions[0])) endpoint.searchParams.set('state', query.regions[0])
  const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(25_000), headers: { accept: 'application/json' } }), 'SAM.gov Opportunities API')
  const rows = (Array.isArray(body.opportunitiesData) ? body.opportunitiesData : Array.isArray(body.data) ? body.data : []) as Record<string, unknown>[]
  return rows.map(row => {
    const externalId = scalar(row.noticeId) || scalar(row.solicitationNumber)
    const title = scalar(row.title) || `SAM.gov 公告 ${externalId}`
    const office = row.officeAddress as Record<string, unknown> | undefined
    const performance = row.placeOfPerformance as Record<string, unknown> | undefined
    const points = Array.isArray(row.pointOfContact) ? row.pointOfContact : []
    const item = {
      provider: 'sam-gov' as const, externalId, title,
      buyer: scalar(row.fullParentPathName) || scalar(row.organizationName) || '美国政府采购机构',
      description: scalar(row.description), country: firstText(performance?.country) || scalar(office?.countryCode) || 'USA',
      noticeType: scalar(row.type) || 'Contract Opportunity', status: scalar(row.active) === 'No' ? 'inactive' : 'active',
      publishedAt: timestamp(row.postedDate), deadlineAt: timestamp(row.responseDeadLine),
      sourceUrl: scalar(row.uiLink) || `https://sam.gov/opp/${encodeURIComponent(externalId)}/view`,
      contact: { points }, metadata: { solicitationNumber: row.solicitationNumber, naicsCode: row.naicsCode, setAside: row.typeOfSetAsideDescription }, relevanceScore: 0,
    }
    return { ...item, relevanceScore: keywordScore(item, query) }
  }).filter(item => item.externalId && item.title)
}

export const fetchUngmOpportunities = async (query: ProcurementQuery, connection: Connection | null, fetchImpl: typeof fetch = fetch): Promise<ProcurementOpportunityInput[]> => {
  const token = secretFor(connection)
  if (!token) throw new Error('UNGM 连接缺少 OAuth 访问令牌。')
  const endpoint = new URL(connection?.endpoint || 'https://www.ungm.org/API/Notices')
  endpoint.searchParams.set('$top', String(Math.min(100, Math.max(1, query.limit))))
  if (query.keywords[0]) endpoint.searchParams.set('$filter', `contains(Title,'${query.keywords[0].replace(/'/g, "''")}')`)
  const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(25_000), headers: { accept: 'application/json', authorization: `Bearer ${token}` } }), 'UNGM Notices API')
  const rows = (Array.isArray(body.value) ? body.value : []) as Record<string, unknown>[]
  return rows.map(row => {
    const externalId = scalar(row.Id) || scalar(row.Reference)
    const title = scalar(row.Title) || `UNGM 公告 ${externalId}`
    const item = {
      provider: 'ungm' as const, externalId, title, buyer: scalar(row.AgencyName) || '联合国采购机构',
      description: scalar(row.Description), country: firstText(row.CountryISO3Codes) || '全球',
      noticeType: scalar(row.Type) || 'UN Procurement Notice', status: scalar(row.Status) || 'active',
      publishedAt: timestamp(row.DatePublished), deadlineAt: timestamp(row.Deadline),
      sourceUrl: `https://www.ungm.org/Public/Notice/${encodeURIComponent(externalId)}`,
      contact: {}, metadata: { reference: row.Reference, unspscIds: row.UnspscIds }, relevanceScore: 0,
    }
    return { ...item, relevanceScore: keywordScore(item, query) }
  }).filter(item => item.externalId && item.title)
}

export const fetchWorldBankOpportunities = async (query: ProcurementQuery, fetchImpl: typeof fetch = fetch): Promise<ProcurementOpportunityInput[]> => {
  const endpoint = new URL('https://search.worldbank.org/api/v2/procnotices')
  endpoint.searchParams.set('format', 'json')
  endpoint.searchParams.set('rows', String(Math.min(100, Math.max(1, query.limit))))
  endpoint.searchParams.set('os', '0')
  endpoint.searchParams.set('apilang', 'en')
  endpoint.searchParams.set('srce', 'both')
  endpoint.searchParams.set('srt', 'submission_deadline_date')
  endpoint.searchParams.set('order', 'asc')
  endpoint.searchParams.set('fl', 'id,notice_type,noticedate,notice_status,project_ctry_name,project_id,project_name,bid_reference_no,bid_description,procurement_group,procurement_method_name,submission_date,submission_deadline_date')
  if (query.keywords.length) endpoint.searchParams.set('qterm', query.keywords.slice(0, 8).join(' '))
  if (query.noticeTypes.length) endpoint.searchParams.set('notice_type_exact', query.noticeTypes.slice(0, 8).join('^'))
  const body = await readJson(await fetchImpl(endpoint, { signal: AbortSignal.timeout(25_000), headers: { accept: 'application/json' } }), 'World Bank Procurement Notices API')
  const rows = (Array.isArray(body.procnotices) ? body.procnotices : []) as Record<string, unknown>[]
  return rows.map(row => {
    const externalId = scalar(row.id)
    const title = scalar(row.bid_description) || scalar(row.project_name) || `World Bank 公告 ${externalId}`
    const item = {
      provider: 'world-bank' as const, externalId, title,
      buyer: scalar(row.project_name) || 'World Bank 项目采购方', description: scalar(row.bid_description),
      country: scalar(row.project_ctry_name) || '全球', noticeType: scalar(row.notice_type) || 'Procurement Notice',
      status: scalar(row.notice_status) || 'Published', publishedAt: timestamp(row.submission_date) || timestamp(row.noticedate),
      deadlineAt: timestamp(row.submission_deadline_date),
      sourceUrl: `https://projects.worldbank.org/en/projects-operations/procurement?id=${encodeURIComponent(externalId)}`,
      contact: {}, metadata: { projectId: row.project_id, bidReference: row.bid_reference_no, procurementGroup: row.procurement_group, procurementMethod: row.procurement_method_name }, relevanceScore: 0,
    }
    return { ...item, relevanceScore: keywordScore(item, query) }
  }).filter(item => item.externalId && item.title)
}

export const fetchProcurementOpportunities = async (provider: string, query: ProcurementQuery, connection: Connection | null, fetchImpl: typeof fetch = fetch) => {
  if (provider === 'ted') return fetchTedOpportunities(query, fetchImpl)
  if (provider === 'sam-gov') return fetchSamOpportunities(query, connection, fetchImpl)
  if (provider === 'ungm') return fetchUngmOpportunities(query, connection, fetchImpl)
  if (provider === 'world-bank') return fetchWorldBankOpportunities(query, fetchImpl)
  throw new Error('该采购来源当前没有可验证的官方机器接口。')
}
