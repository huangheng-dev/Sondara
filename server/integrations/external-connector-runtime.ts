import { and, eq, or, sql } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { customers, inboxContacts } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { assertSafeOutboundUrl } from '../lib/url-safety.js'
import { recordCustomerTouchpoint } from '../leads/touchpoints.js'

export type ConnectorRecord = {
  externalId: string
  company?: string
  name?: string
  email?: string
  phone?: string
  jobTitle?: string
  region?: string
  industry?: string
  website?: string
  contactId?: string
  valid?: boolean
  detail?: string
  raw?: unknown
}

type RuntimeInput = {
  connectorKey: string
  settings: Record<string, string>
  credentials: Record<string, string>
  query?: string
  cursor?: string
  limit: number
  values?: Array<{ id: string; value: string }>
  exportRecords?: ConnectorRecord[]
}

const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const atPath = (value: unknown, path: string) => path.split('.').filter(Boolean).reduce<unknown>((current, key) => object(current)[key], value)
const firstArray = (payload: unknown, configuredPath = '') => {
  if (Array.isArray(payload)) return payload
  if (configuredPath) { const configured = atPath(payload, configuredPath); if (Array.isArray(configured)) return configured }
  const body = object(payload)
  return [body.items, body.data, body.results, object(body.data).items, object(body.data).results].find(Array.isArray) ?? []
}
const fetchJson = async (rawUrl: string, init: RequestInit = {}) => {
  const url = await assertSafeOutboundUrl(rawUrl, { allowPrivate: config.allowPrivateConnectors, label: '连接器接口地址' })
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json', ...init.headers } })
  const text = await response.text()
  let payload: unknown = {}
  try { payload = text ? JSON.parse(text) : {} } catch { throw new Error(`服务商返回了非 JSON 响应（HTTP ${response.status}）。`) }
  if (!response.ok) {
    const message = scalar(object(payload).message) || scalar(object(payload).error) || `服务商返回 HTTP ${response.status}`
    throw new Error(message.slice(0, 500))
  }
  return payload
}
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
export const fetchConnectorJson = fetchJson
export const resolveHubspotToken = async (settings: Record<string, string>, credentials: Record<string, string>) => {
  let token = credentials.accessToken
  if (settings.clientId || credentials.clientSecret) {
    if (!settings.clientId || !credentials.clientSecret) throw new Error('HubSpot OAuth 模式需要同时配置 Client ID、Client Secret 和 Refresh Token。')
    const form = new URLSearchParams({ grant_type: 'refresh_token', client_id: settings.clientId, client_secret: credentials.clientSecret, refresh_token: credentials.accessToken })
    const payload = object(await fetchJson('https://api.hubspot.com/oauth/2026-03/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }))
    token = scalar(payload.access_token)
    if (!token) throw new Error('HubSpot OAuth 刷新响应缺少 access_token。')
  }
  return token
}
const genericRecord = (value: unknown, index: number, mappingJson = ''): ConnectorRecord => {
  const item = object(value); const company = object(item.company); const organization = object(item.organization)
  let mapping: Record<string, unknown> = {}; try { mapping = mappingJson ? object(JSON.parse(mappingJson)) : {} } catch { throw new Error('字段路径映射必须是有效的 JSON 对象。') }
  const mapped = (key: string) => typeof mapping[key] === 'string' ? scalar(atPath(item, String(mapping[key]))) : ''
  const email = scalar(item.email) || scalar(item.work_email)
  const domain = scalar(item.domain) || scalar(item.website) || scalar(company.domain) || scalar(organization.website_url)
  return {
    externalId: mapped('id') || scalar(item.id) || scalar(item.external_id) || scalar(item.uuid) || `${domain || email || 'record'}-${index}`,
    company: mapped('company') || scalar(item.company_name) || scalar(item.company) || scalar(item.organization_name) || scalar(company.name) || scalar(organization.name) || (email.includes('@') ? email.split('@')[1] : ''),
    name: mapped('name') || scalar(item.full_name) || scalar(item.name) || [scalar(item.first_name), scalar(item.last_name)].filter(Boolean).join(' '),
    email: mapped('email') || email,
    phone: mapped('phone') || scalar(item.phone) || scalar(item.phone_number),
    jobTitle: mapped('jobTitle') || scalar(item.job_title) || scalar(item.title),
    region: mapped('region') || scalar(item.region) || scalar(item.country) || scalar(item.location) || scalar(organization.country),
    industry: mapped('industry') || scalar(item.industry) || scalar(company.industry) || scalar(organization.industry),
    website: mapped('website') || domain,
    raw: value,
  }
}

export const executeExternalConnector = async (input: RuntimeInput): Promise<{ records: ConnectorRecord[]; cursor: string | null; exportedCount?: number }> => {
  const endpoint = input.settings.endpoint
  if (input.connectorKey === 'company-contact-database') {
    const payload = await fetchJson(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': input.credentials.apiKey }, body: JSON.stringify({ q_keywords: input.query || undefined, page: Number(input.cursor || 1), per_page: input.limit }) })
    const body = object(payload); const rows = firstArray(body.people ? { items: body.people } : payload)
    return { records: rows.map((value, index) => genericRecord(value, index)), cursor: rows.length === input.limit ? String(Number(input.cursor || 1) + 1) : null }
  }
  if (input.connectorKey === 'email-verification') {
    const records: ConnectorRecord[] = []
    const providerKey = input.settings.providerKey?.toLowerCase() || 'hunter'
    for (const target of input.values ?? []) {
      const url = new URL(endpoint); url.searchParams.set('email', target.value)
      if (providerKey === 'neverbounce') url.searchParams.set('key', input.credentials.apiKey)
      else url.searchParams.set('api_key', input.credentials.apiKey)
      const payload = await fetchJson(url.toString())
      const data = providerKey === 'hunter' ? object(object(payload).data) : object(payload)
      const status = scalar(providerKey === 'neverbounce' ? data.result : data.status).toLowerCase()
      const valid = status === 'valid'
      records.push({ externalId: target.id, contactId: target.id, email: target.value, valid, detail: status || 'unknown', raw: data })
    }
    return { records, cursor: null }
  }
  if (input.connectorKey === 'phone-verification') {
    const records: ConnectorRecord[] = []
    const auth = Buffer.from(`${input.settings.accountSid}:${input.credentials.authToken}`).toString('base64')
    for (const target of input.values ?? []) {
      const url = `${endpoint.replace(/\/$/, '')}/${encodeURIComponent(target.value)}`
      const payload = object(await fetchJson(url, { headers: { authorization: `Basic ${auth}` } }))
      records.push({ externalId: target.id, contactId: target.id, phone: scalar(payload.phone_number) || target.value, region: scalar(payload.country_code), valid: payload.valid === true, detail: (Array.isArray(payload.validation_errors) ? payload.validation_errors.join(', ') : '') || (payload.valid === true ? 'valid' : 'invalid'), raw: payload })
    }
    return { records, cursor: null }
  }
  if (input.connectorKey === 'crm-sync') {
    const hubspotToken = await resolveHubspotToken(input.settings, input.credentials)
    let exportedCount = 0
    if (input.settings.syncDirection !== '仅导入到 Sondara' && input.exportRecords?.length) {
      const batchUrl = endpoint.replace(/\/contacts(?:\?.*)?\/?$/, '/contacts/batch/upsert')
      const exportable = input.exportRecords.filter(record => record.email).map(record => ({ id: record.email, idProperty: 'email', properties: { email: record.email, firstname: record.name?.split(/\s+/)[0] || '', lastname: record.name?.split(/\s+/).slice(1).join(' ') || '', jobtitle: record.jobTitle || '', phone: record.phone || '', company: record.company || '', country: record.region || '' } }))
      if (exportable.length) { await fetchJson(batchUrl, { method: 'POST', headers: { ...bearer(hubspotToken), 'content-type': 'application/json' }, body: JSON.stringify({ inputs: exportable }) }); exportedCount = exportable.length }
    }
    if (input.settings.syncDirection === '仅导出到 CRM') return { records: [], cursor: null, exportedCount }
    const url = new URL(endpoint); url.searchParams.set('limit', String(input.limit)); url.searchParams.set('properties', 'email,firstname,lastname,jobtitle,phone,company,country,website'); if (input.cursor) url.searchParams.set('after', input.cursor)
    const payload = object(await fetchJson(url.toString(), { headers: bearer(hubspotToken) }))
    const rows = Array.isArray(payload.results) ? payload.results : []
    const records = rows.map((value, index) => { const item = object(value); return genericRecord({ id: item.id, ...object(item.properties) }, index) })
    return { records, cursor: scalar(object(object(payload.paging).next).after) || null, exportedCount }
  }
  if (['trade-supply-chain-data', 'vertical-industry-database'].includes(input.connectorKey)) {
    const url = new URL(endpoint); url.searchParams.set('limit', String(input.limit)); if (input.query) url.searchParams.set('q', input.query); if (input.cursor) url.searchParams.set('cursor', input.cursor)
    const payload = await fetchJson(url.toString(), { headers: { 'x-api-key': input.credentials.apiKey, ...bearer(input.credentials.apiKey) } })
    const rows = firstArray(payload, input.settings.itemsPath)
    const body = object(payload)
    return { records: rows.map((value, index) => genericRecord(value, index, input.settings.fieldMapping)), cursor: scalar(body.next_cursor) || scalar(object(body.paging).next) || null }
  }
  throw new Error('该连接器通过签名 Webhook 接收入站事件，不支持主动拉取。')
}

export const applyConnectorRecords = async (workspaceId: string, connectorKey: string, connectorName: string, records: ConnectorRecord[]) => {
  let createdCount = 0; let updatedCount = 0; let skippedCount = 0
  for (const record of records) {
    const now = Date.now()
    if (record.contactId && record.valid !== undefined) {
      const contact = await db.$first(db.select().from(inboxContacts).where(and(eq(inboxContacts.id, record.contactId), eq(inboxContacts.workspaceId, workspaceId))))
      if (!contact) { skippedCount += 1; continue }
      await db.update(inboxContacts).set({ verificationStatus: record.valid ? 'verified' : 'invalid', verifiedAt: record.valid ? now : null, verificationSource: `${connectorName} · ${record.detail || 'API 验证'}`, phone: record.phone || contact.phone, region: contact.region === '待补全' && record.region ? record.region : contact.region, updatedAt: now }).where(eq(inboxContacts.id, contact.id))
      updatedCount += 1; continue
    }
    const companyName = (record.company || '').trim()
    if (!companyName) { skippedCount += 1; continue }
    let customer = await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, workspaceId), sql`lower(${customers.company}) = ${companyName.toLowerCase()}`)))
    if (!customer) {
      const id = createId('cus')
      await db.insert(customers).values({ id, workspaceId, company: companyName, region: record.region || '待补全', industry: record.industry || '待补全', score: 45, confidence: 65, signal: '第三方授权数据补全', source: connectorName, stage: '待验证', interaction: '通过授权连接器导入', nextAction: '核验企业与联系人后决定是否跟进', createdAt: now, updatedAt: now })
      customer = await db.$first(db.select().from(customers).where(eq(customers.id, id))); createdCount += 1
    } else { updatedCount += 1 }
    if (!customer) continue
    if (record.email || record.phone || record.name) {
      const identity = [record.email ? eq(inboxContacts.email, record.email) : null, record.phone ? eq(inboxContacts.phone, record.phone) : null].filter((value): value is NonNullable<typeof value> => value !== null)
      const existing = identity.length ? await db.$first(db.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, workspaceId), or(...identity)))) : await db.$first(db.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, workspaceId), eq(inboxContacts.company, companyName), eq(inboxContacts.name, record.name || '待确认联系人'))))
      if (!existing) await db.insert(inboxContacts).values({ id: createId('ict'), workspaceId, customerId: customer.id, name: record.name || record.email?.split('@')[0] || '待确认联系人', company: companyName, jobTitle: record.jobTitle || '待补全', region: record.region || '待补全', source: connectorName, primaryChannel: record.email ? '邮件' : record.phone ? '电话' : '待确认', email: record.email || null, phone: record.phone || null, externalRef: record.externalId, verificationStatus: 'unverified', createdAt: now, updatedAt: now })
    }
    await recordCustomerTouchpoint({ workspaceId, customerId: customer.id, eventType: 'connector_import', source: connectorKey, medium: 'authorized-api', externalId: record.externalId, metadata: { connectorName, website: record.website } })
  }
  return { createdCount, updatedCount, skippedCount }
}
