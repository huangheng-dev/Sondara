import { and, eq, or, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { customers, deals, externalConnectorConfigurations, externalObjectMappings, tasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { fetchConnectorJson, resolveHubspotToken } from './external-connector-runtime.js'

type Configuration = typeof externalConnectorConfigurations.$inferSelect
type MappingType = 'company' | 'deal' | 'task'
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const epoch = (value: unknown) => { const parsed = Date.parse(scalar(value)); return Number.isFinite(parsed) ? parsed : null }
const auth = (token: string) => ({ authorization: `Bearer ${token}` })
const stageFromHubspot = (value: string) => ({ appointmentscheduled: '需求确认', qualifiedtobuy: '方案评估', presentationscheduled: '方案评估', decisionmakerboughtin: '商务谈判', contractsent: '商务谈判', closedwon: '已成交', closedlost: '已流失' } as Record<string, string>)[value] || value || '线索确认'
const stageToHubspot = (value: string) => ({ 需求确认: 'appointmentscheduled', 方案评估: 'presentationscheduled', 商务谈判: 'contractsent', 已成交: 'closedwon', 已流失: 'closedlost' } as Record<string, string>)[value] || 'appointmentscheduled'

const mappingFor = async (configurationId: string, objectType: MappingType, input: { localId?: string; externalId?: string }) => db.$first(db.select().from(externalObjectMappings).where(and(eq(externalObjectMappings.configurationId, configurationId), eq(externalObjectMappings.objectType, objectType), or(...[input.localId ? eq(externalObjectMappings.localId, input.localId) : null, input.externalId ? eq(externalObjectMappings.externalId, input.externalId) : null].filter((item): item is NonNullable<typeof item> => item !== null)))))
const saveMapping = async (configuration: Configuration, objectType: MappingType, localId: string, externalId: string, localUpdatedAt: number | null, externalUpdatedAt: number | null) => {
  const now = Date.now(); const existing = await mappingFor(configuration.id, objectType, { localId, externalId })
  if (existing) await db.update(externalObjectMappings).set({ localId, externalId, localUpdatedAt, externalUpdatedAt, lastSyncedAt: now }).where(eq(externalObjectMappings.id, existing.id))
  else await db.insert(externalObjectMappings).values({ id: createId('eom'), workspaceId: configuration.workspaceId, configurationId: configuration.id, objectType, localId, externalId, localUpdatedAt, externalUpdatedAt, lastSyncedAt: now })
}
const companyIdFromAssociations = (item: Record<string, unknown>) => {
  const companies = object(object(item.associations).companies)
  const first = Array.isArray(companies.results) ? object(companies.results[0]) : {}
  return scalar(first.id)
}
const fetchObjects = async (origin: string, token: string, objectType: MappingType, properties: string[], limit: number) => {
  const url = new URL(`/crm/objects/2026-03/${objectType === 'company' ? 'companies' : objectType === 'deal' ? 'deals' : 'tasks'}`, origin)
  url.searchParams.set('limit', String(limit)); url.searchParams.set('properties', properties.join(',')); if (objectType !== 'company') url.searchParams.set('associations', 'companies')
  const payload = object(await fetchConnectorJson(url.toString(), { headers: auth(token) }))
  return Array.isArray(payload.results) ? payload.results.map(object) : []
}

const importCompanies = async (configuration: Configuration, origin: string, token: string, limit: number) => {
  const rows = await fetchObjects(origin, token, 'company', ['name', 'domain', 'industry', 'country', 'city', 'numberofemployees', 'annualrevenue'], limit)
  let imported = 0; let skipped = 0
  for (const item of rows) {
    const externalId = scalar(item.id); const properties = object(item.properties); const name = scalar(properties.name) || scalar(properties.domain); const externalUpdatedAt = epoch(item.updatedAt)
    if (!externalId || !name) { skipped += 1; continue }
    const mapped = await mappingFor(configuration.id, 'company', { externalId })
    let customer = mapped ? await db.$first(db.select().from(customers).where(and(eq(customers.id, mapped.localId), eq(customers.workspaceId, configuration.workspaceId)))) : undefined
    customer ??= await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, configuration.workspaceId), sql`lower(${customers.company}) = ${name.toLowerCase()}`)))
    if (customer && mapped && customer.updatedAt > mapped.lastSyncedAt && (!externalUpdatedAt || customer.updatedAt > externalUpdatedAt)) { skipped += 1; continue }
    const now = Date.now()
    if (customer) await db.update(customers).set({ company: name, region: scalar(properties.country) || scalar(properties.city) || customer.region, industry: scalar(properties.industry) || customer.industry, size: scalar(properties.numberofemployees) || customer.size, estimatedValue: Number(scalar(properties.annualrevenue)) || customer.estimatedValue, source: 'HubSpot CRM', updatedAt: now }).where(eq(customers.id, customer.id))
    else { const id = createId('cus'); await db.insert(customers).values({ id, workspaceId: configuration.workspaceId, company: name, region: scalar(properties.country) || scalar(properties.city) || '待补全', industry: scalar(properties.industry) || '待补全', size: scalar(properties.numberofemployees) || '待补全', estimatedValue: Number(scalar(properties.annualrevenue)) || 0, source: 'HubSpot CRM', signal: 'CRM 授权同步', stage: '待验证', createdAt: now, updatedAt: now }); customer = await db.$first(db.select().from(customers).where(eq(customers.id, id))) }
    if (customer) { await saveMapping(configuration, 'company', customer.id, externalId, customer.updatedAt, externalUpdatedAt); imported += 1 }
  }
  return { imported, skipped }
}

const importDeals = async (configuration: Configuration, origin: string, token: string, limit: number) => {
  const rows = await fetchObjects(origin, token, 'deal', ['dealname', 'amount', 'dealstage', 'closedate', 'pipeline', 'hs_lastmodifieddate'], limit)
  let imported = 0; let skipped = 0
  for (const item of rows) {
    const externalId = scalar(item.id); const companyExternalId = companyIdFromAssociations(item); const companyMapping = companyExternalId ? await mappingFor(configuration.id, 'company', { externalId: companyExternalId }) : undefined
    if (!externalId || !companyMapping) { skipped += 1; continue }
    const customer = await db.$first(db.select().from(customers).where(eq(customers.id, companyMapping.localId))); if (!customer) { skipped += 1; continue }
    const properties = object(item.properties); const externalUpdatedAt = epoch(item.updatedAt) || epoch(properties.hs_lastmodifieddate); const mapped = await mappingFor(configuration.id, 'deal', { externalId })
    let deal = mapped ? await db.$first(db.select().from(deals).where(eq(deals.id, mapped.localId))) : await db.$first(db.select().from(deals).where(and(eq(deals.workspaceId, configuration.workspaceId), eq(deals.company, customer.company))))
    if (deal && mapped && deal.updatedAt > mapped.lastSyncedAt && (!externalUpdatedAt || deal.updatedAt > externalUpdatedAt)) { skipped += 1; continue }
    const now = Date.now(); const values = { customerId: customer.id, company: customer.company, stage: stageFromHubspot(scalar(properties.dealstage)), valueAmount: Math.round(Number(scalar(properties.amount)) || 0), expectedCloseAt: epoch(properties.closedate), source: 'HubSpot CRM', updatedAt: now }
    if (deal) await db.update(deals).set(values).where(eq(deals.id, deal.id))
    else { const id = createId('dea'); await db.insert(deals).values({ id, workspaceId: configuration.workspaceId, ...values, stageEnteredAt: now, createdAt: now }); deal = await db.$first(db.select().from(deals).where(eq(deals.id, id))) }
    if (deal) { await saveMapping(configuration, 'deal', deal.id, externalId, deal.updatedAt, externalUpdatedAt); imported += 1 }
  }
  return { imported, skipped }
}

const importTasks = async (configuration: Configuration, origin: string, token: string, limit: number) => {
  const rows = await fetchObjects(origin, token, 'task', ['hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_priority', 'hs_timestamp'], limit)
  let imported = 0; let skipped = 0
  for (const item of rows) {
    const externalId = scalar(item.id); const companyExternalId = companyIdFromAssociations(item); const companyMapping = companyExternalId ? await mappingFor(configuration.id, 'company', { externalId: companyExternalId }) : undefined
    if (!externalId || !companyMapping) { skipped += 1; continue }
    const customer = await db.$first(db.select().from(customers).where(eq(customers.id, companyMapping.localId))); if (!customer) { skipped += 1; continue }
    const properties = object(item.properties); const externalUpdatedAt = epoch(item.updatedAt); const mapped = await mappingFor(configuration.id, 'task', { externalId })
    let task = mapped ? await db.$first(db.select().from(tasks).where(eq(tasks.id, mapped.localId))) : undefined
    if (task && mapped && task.updatedAt > mapped.lastSyncedAt && (!externalUpdatedAt || task.updatedAt > externalUpdatedAt)) { skipped += 1; continue }
    const now = Date.now(); const values = { customerId: customer.id, title: scalar(properties.hs_task_subject) || 'HubSpot 跟进任务', priority: scalar(properties.hs_task_priority).toUpperCase() === 'HIGH' ? '高' : '中', dueAt: epoch(properties.hs_timestamp), dueLabel: epoch(properties.hs_timestamp) ? new Date(epoch(properties.hs_timestamp)!).toLocaleDateString('zh-CN') : '待安排', company: customer.company, impact: scalar(properties.hs_task_body) || 'HubSpot 同步任务', source: 'HubSpot CRM', status: scalar(properties.hs_task_status).toUpperCase() === 'COMPLETED' ? 'done' : 'open', updatedAt: now }
    if (task) await db.update(tasks).set(values).where(eq(tasks.id, task.id))
    else { const id = createId('tsk'); await db.insert(tasks).values({ id, workspaceId: configuration.workspaceId, ...values, createdAt: now }); task = await db.$first(db.select().from(tasks).where(eq(tasks.id, id))) }
    if (task) { await saveMapping(configuration, 'task', task.id, externalId, task.updatedAt, externalUpdatedAt); imported += 1 }
  }
  return { imported, skipped }
}

const upsertRemote = async (configuration: Configuration, origin: string, token: string, objectType: MappingType, local: { id: string; updatedAt: number; properties: Record<string, string>; customerId?: string | null }) => {
  const pathType = objectType === 'company' ? 'companies' : objectType === 'deal' ? 'deals' : 'tasks'; const mapped = await mappingFor(configuration.id, objectType, { localId: local.id })
  const url = mapped ? new URL(`/crm/objects/2026-03/${pathType}/${mapped.externalId}`, origin) : new URL(`/crm/objects/2026-03/${pathType}`, origin)
  const payload = object(await fetchConnectorJson(url.toString(), { method: mapped ? 'PATCH' : 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body: JSON.stringify({ properties: local.properties }) }))
  const externalId = mapped?.externalId || scalar(payload.id); if (!externalId) throw new Error(`HubSpot ${objectType} 写入响应缺少记录 ID。`)
  await saveMapping(configuration, objectType, local.id, externalId, local.updatedAt, epoch(payload.updatedAt))
  if (objectType !== 'company' && local.customerId) {
    const companyMapping = await mappingFor(configuration.id, 'company', { localId: local.customerId })
    if (companyMapping) await fetchConnectorJson(new URL(`/crm/objects/2026-03/${pathType}/${externalId}/associations/default/companies/${companyMapping.externalId}`, origin).toString(), { method: 'PUT', headers: auth(token) })
  }
  return 1
}

const exportObjects = async (configuration: Configuration, origin: string, token: string, limit: number) => {
  let exported = 0
  for (const item of await db.select().from(customers).where(eq(customers.workspaceId, configuration.workspaceId)).limit(limit)) exported += await upsertRemote(configuration, origin, token, 'company', { id: item.id, updatedAt: item.updatedAt, properties: { name: item.company, country: item.region === '待补全' ? '' : item.region, industry: item.industry === '待补全' ? '' : item.industry, numberofemployees: item.size === '待补全' ? '' : item.size } })
  for (const item of await db.select().from(deals).where(eq(deals.workspaceId, configuration.workspaceId)).limit(limit)) exported += await upsertRemote(configuration, origin, token, 'deal', { id: item.id, updatedAt: item.updatedAt, customerId: item.customerId, properties: { dealname: `${item.company} · Sondara`, amount: String(item.valueAmount), dealstage: stageToHubspot(item.stage), closedate: item.expectedCloseAt ? new Date(item.expectedCloseAt).toISOString() : '', pipeline: 'default' } })
  for (const item of await db.select().from(tasks).where(eq(tasks.workspaceId, configuration.workspaceId)).limit(limit)) exported += await upsertRemote(configuration, origin, token, 'task', { id: item.id, updatedAt: item.updatedAt, customerId: item.customerId, properties: { hs_task_subject: item.title, hs_task_body: item.impact, hs_task_status: item.status === 'done' ? 'COMPLETED' : 'NOT_STARTED', hs_task_priority: item.priority === '高' ? 'HIGH' : 'MEDIUM', hs_timestamp: item.dueAt ? new Date(item.dueAt).toISOString() : new Date().toISOString() } })
  return exported
}

export const syncHubspotCrmObjects = async (configuration: Configuration, settings: Record<string, string>, credentials: Record<string, string>, limit: number) => {
  const token = await resolveHubspotToken(settings, credentials); const origin = new URL(settings.endpoint).origin
  let imported = 0; let exported = 0; let skipped = 0
  if (settings.syncDirection !== '仅导出到 CRM') {
    const companiesResult = await importCompanies(configuration, origin, token, limit); imported += companiesResult.imported; skipped += companiesResult.skipped
    const dealsResult = await importDeals(configuration, origin, token, limit); imported += dealsResult.imported; skipped += dealsResult.skipped
    const tasksResult = await importTasks(configuration, origin, token, limit); imported += tasksResult.imported; skipped += tasksResult.skipped
  }
  if (settings.syncDirection !== '仅导入到 Sondara') exported = await exportObjects(configuration, origin, token, limit)
  return { imported, exported, skipped }
}
