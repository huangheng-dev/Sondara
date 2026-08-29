import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { auditLogs, externalConnectorConfigurations, externalConnectorRuns, integrationConnections } from '../db/schema.js'
import { connectorCatalogByKey, externalConnectorCatalog } from '../integrations/connector-catalog.js'
import { ExternalConnectorRunError, runConfiguredExternalConnector } from '../integrations/external-connector-service.js'
import { discoverPlacesWithConnection } from '../integrations/map-client.js'
import { searchWithConnection } from '../integrations/search-client.js'
import { fetchProcurementOpportunities } from '../procurement/connectors.js'
import { createId } from '../lib/ids.js'
import { decryptSecret, encryptSecret } from '../lib/secret-vault.js'
import { assertSafeOutboundUrl, UnsafeUrlError } from '../lib/url-safety.js'
import { requireAdmin, requireAuth } from '../plugins/auth.js'

const provider = z.enum(['brave', 'tavily', 'serpapi', 'google', 'bing', 'searxng', 'google-places', 'sam-gov', 'ungm'])
const category = z.enum(['search', 'map', 'procurement'])
const defaults = {
  brave: { category: 'search', name: 'Brave Search', endpoint: 'https://api.search.brave.com/res/v1/web/search' },
  tavily: { category: 'search', name: 'Tavily Search', endpoint: 'https://api.tavily.com/search' },
  serpapi: { category: 'search', name: 'SerpAPI', endpoint: 'https://serpapi.com/search' },
  google: { category: 'search', name: 'Google Custom Search', endpoint: 'https://www.googleapis.com/customsearch/v1' },
  bing: { category: 'search', name: 'Bing Web Search', endpoint: 'https://api.bing.microsoft.com/v7.0/search' },
  searxng: { category: 'search', name: 'SearXNG', endpoint: '' },
  'google-places': { category: 'map', name: 'Google Places', endpoint: 'https://places.googleapis.com/v1/places:searchText' },
  'sam-gov': { category: 'procurement', name: 'SAM.gov Opportunities', endpoint: 'https://api.sam.gov/opportunities/v2/search' },
  ungm: { category: 'procurement', name: 'UNGM Notices', endpoint: 'https://www.ungm.org/API/Notices' },
} as const
const createInput = z.object({
  category: category.default('search'), name: z.string().trim().max(120).optional(), provider,
  endpoint: z.string().trim().url().optional(), secret: z.string().trim().max(500).optional(),
  priority: z.number().int().min(1).max(100).optional(), resultLimit: z.number().int().min(1).max(20).default(10),
})
const patchInput = z.object({ name: z.string().trim().min(1).max(120).optional(), endpoint: z.string().trim().url().optional(), secret: z.string().trim().max(500).optional(), priority: z.number().int().min(1).max(100).optional(), enabled: z.boolean().optional(), resultLimit: z.number().int().min(1).max(20).optional() })
const externalConnectorInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().default(true),
  settings: z.record(z.string(), z.string().trim().max(2000)).default({}),
  credentials: z.record(z.string(), z.string().trim().max(4000)).default({}),
})
const externalRunInput = z.object({ query: z.string().trim().max(300).optional(), cursor: z.string().trim().max(300).optional(), limit: z.number().int().min(1).max(100).default(25), importRecords: z.boolean().default(true) })
const externalScheduleInput = z.object({ enabled: z.boolean(), intervalMinutes: z.number().int().min(15).max(43_200), query: z.string().trim().max(300).optional(), perRunLimit: z.number().int().min(1).max(100), dailyLimit: z.number().int().min(1).max(10_000) })

const safeJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T } catch { return fallback } }
const view = async (workspaceId: string) => (await db.select().from(integrationConnections).where(eq(integrationConnections.workspaceId, workspaceId)).orderBy(asc(integrationConnections.category), asc(integrationConnections.priority))).map(item => ({
  id: item.id, workspaceId: item.workspaceId, category: item.category, name: item.name, provider: item.provider, endpoint: item.endpoint,
  priority: item.priority, enabled: item.enabled, status: item.status, secretEnding: item.secretEnding, hasSecret: Boolean(item.secretCiphertext),
  config: safeJson(item.configJson, {}), lastLatencyMs: item.lastLatencyMs, lastError: item.lastError, lastTestedAt: item.lastTestedAt,
  createdAt: item.createdAt, updatedAt: item.updatedAt,
}))
const audit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => (await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'integration_connection', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() }))
const externalConfigView = (item: typeof externalConnectorConfigurations.$inferSelect | undefined) => item ? {
  id: item.id,
  connectorKey: item.connectorKey,
  name: item.name,
  enabled: item.enabled,
  status: item.status,
  settings: safeJson<Record<string, string>>(item.settingsJson, {}),
  credentialEndings: safeJson<Record<string, string>>(item.credentialEndingsJson, {}),
  hasCredentials: Boolean(item.credentialsCiphertext),
  webhookPath: item.connectorKey === 'website-visitor-identification' ? `/api/external-connectors/webhook/${item.id}` : null,
  lastError: item.lastError,
  lastValidatedAt: item.lastValidatedAt,
  scheduleEnabled: item.scheduleEnabled,
  scheduleIntervalMinutes: item.scheduleIntervalMinutes,
  scheduleQuery: item.scheduleQuery,
  perRunLimit: item.perRunLimit,
  dailyLimit: item.dailyLimit,
  nextRunAt: item.nextRunAt,
  cursor: item.cursor,
  consecutiveFailures: item.consecutiveFailures,
  pausedReason: item.pausedReason,
  lastRunAt: item.lastRunAt,
  createdAt: item.createdAt,
  updatedAt: item.updatedAt,
} : null
const existingCredentials = (item: typeof externalConnectorConfigurations.$inferSelect | undefined) => item?.credentialsCiphertext && item.credentialsIv && item.credentialsTag
  ? safeJson<Record<string, string>>(decryptSecret({ ciphertext: item.credentialsCiphertext, iv: item.credentialsIv, tag: item.credentialsTag }), {}) : {}

export const integrationRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)
  app.get('/connections', async request => ({ items: (await view(request.auth.workspaceId)) }))

  app.get('/catalog', async request => {
    const configured = await db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.workspaceId, request.auth.workspaceId))
    const byKey = new Map(configured.map(item => [item.connectorKey, item]))
    return { items: externalConnectorCatalog.map(item => ({ ...item, configuration: externalConfigView(byKey.get(item.key)) })) }
  })

  app.put('/catalog/:key/configuration', { preHandler: requireAdmin }, async (request, reply) => {
    const key = (request.params as { key: string }).key
    const catalog = connectorCatalogByKey.get(key)
    if (!catalog) return reply.code(404).send({ error: 'CONNECTOR_NOT_FOUND', message: '连接器配置槽位不存在。' })
    const parsed = externalConnectorInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const allowedSettings = new Set(catalog.fields.filter(field => !field.secret).map(field => field.key))
    const allowedCredentials = new Set(catalog.fields.filter(field => field.secret).map(field => field.key))
    if (Object.keys(parsed.data.settings).some(field => !allowedSettings.has(field)) || Object.keys(parsed.data.credentials).some(field => !allowedCredentials.has(field))) {
      return reply.code(400).send({ error: 'INVALID_INPUT', message: '提交了该连接器不支持的配置字段。' })
    }
    const current = await db.$first(db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.workspaceId, request.auth.workspaceId), eq(externalConnectorConfigurations.connectorKey, key))))
    const settings = { ...(current ? safeJson<Record<string, string>>(current.settingsJson, {}) : {}), ...Object.fromEntries(Object.entries(parsed.data.settings).filter(([, value]) => value)) }
    const missingSetting = catalog.fields.find(field => field.required && !field.secret && !settings[field.key])
    if (missingSetting) return reply.code(400).send({ error: 'INVALID_INPUT', message: `请填写${missingSetting.label}。` })
    if (settings.endpoint) {
      try { await assertSafeOutboundUrl(settings.endpoint, { allowPrivate: config.allowPrivateConnectors, label: `${catalog.name}接口地址` }) }
      catch (cause) { return reply.code(400).send({ error: 'UNSAFE_ENDPOINT', message: cause instanceof Error ? cause.message : '接口地址不可用。' }) }
    }
    const credentials = { ...existingCredentials(current), ...Object.fromEntries(Object.entries(parsed.data.credentials).filter(([, value]) => value)) }
    if (!Object.keys(credentials).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '至少填写一项 API Key、访问令牌或客户端密钥。' })
    const encrypted = encryptSecret(JSON.stringify(credentials))
    const endings = Object.fromEntries(Object.entries(credentials).map(([field, value]) => [field, value.slice(-4).toUpperCase()]))
    const now = Date.now()
    if (current) {
      await db.update(externalConnectorConfigurations).set({ name: parsed.data.name || current.name, enabled: parsed.data.enabled, settingsJson: JSON.stringify(settings), credentialsCiphertext: encrypted.ciphertext, credentialsIv: encrypted.iv, credentialsTag: encrypted.tag, credentialEndingsJson: JSON.stringify(endings), status: 'configured', lastError: null, lastValidatedAt: null, updatedAt: now }).where(eq(externalConnectorConfigurations.id, current.id))
      await audit(request.auth.workspaceId, request.auth.userId, 'external_connector.updated', current.id, { connectorKey: key, fields: Object.keys(parsed.data.settings), credentialFields: Object.keys(parsed.data.credentials).filter(field => parsed.data.credentials[field]) })
    } else {
      const id = createId('exc')
      await db.insert(externalConnectorConfigurations).values({ id, workspaceId: request.auth.workspaceId, connectorKey: key, name: parsed.data.name || catalog.name, enabled: parsed.data.enabled, status: 'configured', settingsJson: JSON.stringify(settings), credentialsCiphertext: encrypted.ciphertext, credentialsIv: encrypted.iv, credentialsTag: encrypted.tag, credentialEndingsJson: JSON.stringify(endings), lastError: null, lastValidatedAt: null, createdAt: now, updatedAt: now })
      await audit(request.auth.workspaceId, request.auth.userId, 'external_connector.created', id, { connectorKey: key, fields: Object.keys(parsed.data.settings), credentialFields: Object.keys(parsed.data.credentials).filter(field => parsed.data.credentials[field]) })
    }
    const saved = await db.$first(db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.workspaceId, request.auth.workspaceId), eq(externalConnectorConfigurations.connectorKey, key))))
    return externalConfigView(saved)
  })

  app.post('/catalog/:key/validate', { preHandler: requireAdmin }, async (request, reply) => {
    const key = (request.params as { key: string }).key
    const catalog = connectorCatalogByKey.get(key)
    if (!catalog) return reply.code(404).send({ error: 'CONNECTOR_NOT_FOUND', message: '连接器配置槽位不存在。' })
    const current = await db.$first(db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.workspaceId, request.auth.workspaceId), eq(externalConnectorConfigurations.connectorKey, key))))
    if (!current) return reply.code(409).send({ error: 'CONNECTOR_NOT_CONFIGURED', message: '请先保存连接器配置。' })
    const settings = safeJson<Record<string, string>>(current.settingsJson, {})
    const credentials = existingCredentials(current)
    const missing = catalog.fields.find(field => field.required && !(field.secret ? credentials[field.key] : settings[field.key]))
    if (missing || !Object.keys(credentials).length) return reply.code(409).send({ error: 'CONNECTOR_INCOMPLETE', message: missing ? `缺少${missing.label}。` : '缺少访问凭据。' })
    const now = Date.now()
    await db.update(externalConnectorConfigurations).set({ status: 'validated', lastError: null, lastValidatedAt: now, updatedAt: now }).where(eq(externalConnectorConfigurations.id, current.id))
    await audit(request.auth.workspaceId, request.auth.userId, 'external_connector.validated', current.id, { connectorKey: key, networkRequest: false })
    return { ok: true, status: 'validated', networkRequest: false, message: '必填配置完整；启用真实数据同步前仍需按服务商文档完成账号授权和字段映射。' }
  })

  app.get('/catalog/:key/runs', async (request, reply) => {
    const key = (request.params as { key: string }).key
    if (!connectorCatalogByKey.has(key)) return reply.code(404).send({ error: 'CONNECTOR_NOT_FOUND', message: '连接器不存在。' })
    return { items: await db.select().from(externalConnectorRuns).where(and(eq(externalConnectorRuns.workspaceId, request.auth.workspaceId), eq(externalConnectorRuns.connectorKey, key))).orderBy(desc(externalConnectorRuns.startedAt)).limit(30) }
  })

  app.post('/catalog/:key/run', { preHandler: requireAdmin }, async (request, reply) => {
    const key = (request.params as { key: string }).key
    if (!connectorCatalogByKey.has(key)) return reply.code(404).send({ error: 'CONNECTOR_NOT_FOUND', message: '连接器不存在。' })
    if (key === 'website-visitor-identification') return reply.code(409).send({ error: 'WEBHOOK_CONNECTOR', message: '网站访客识别通过签名 Webhook 接收入站事件，不执行主动拉取。' })
    const parsed = externalRunInput.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const current = await db.$first(db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.workspaceId, request.auth.workspaceId), eq(externalConnectorConfigurations.connectorKey, key))))
    if (!current || !current.enabled) return reply.code(409).send({ error: 'CONNECTOR_NOT_READY', message: '请先保存并启用连接器配置。' })
    try {
      return await runConfiguredExternalConnector({ configuration: current, actorUserId: request.auth.userId, query: parsed.data.query, cursor: parsed.data.cursor, limit: parsed.data.limit, importRecords: parsed.data.importRecords })
    } catch (cause) {
      return reply.code(cause instanceof ExternalConnectorRunError && !cause.runId ? 409 : 502).send({ error: 'CONNECTOR_RUN_FAILED', message: cause instanceof Error ? cause.message : '连接器运行失败。', runId: cause instanceof ExternalConnectorRunError ? cause.runId : null })
    }
  })

  app.put('/catalog/:key/schedule', { preHandler: requireAdmin }, async (request, reply) => {
    const key = (request.params as { key: string }).key
    const parsed = externalScheduleInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    if (parsed.data.enabled && ['company-contact-database', 'trade-supply-chain-data', 'vertical-industry-database'].includes(key) && !parsed.data.query) return reply.code(400).send({ error: 'QUERY_REQUIRED', message: '定时发现任务必须配置搜索关键词。' })
    const current = await db.$first(db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.workspaceId, request.auth.workspaceId), eq(externalConnectorConfigurations.connectorKey, key))))
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND', message: '请先保存连接器配置。' })
    const now = Date.now()
    await db.update(externalConnectorConfigurations).set({ scheduleEnabled: parsed.data.enabled, scheduleIntervalMinutes: parsed.data.intervalMinutes, scheduleQuery: parsed.data.query || null, perRunLimit: parsed.data.perRunLimit, dailyLimit: parsed.data.dailyLimit, nextRunAt: parsed.data.enabled ? now : null, pausedReason: parsed.data.enabled ? null : '已手动暂停定时同步。', consecutiveFailures: parsed.data.enabled ? 0 : current.consecutiveFailures, updatedAt: now }).where(eq(externalConnectorConfigurations.id, current.id))
    await audit(request.auth.workspaceId, request.auth.userId, parsed.data.enabled ? 'external_connector.schedule_enabled' : 'external_connector.schedule_paused', current.id, { connectorKey: key, intervalMinutes: parsed.data.intervalMinutes, perRunLimit: parsed.data.perRunLimit, dailyLimit: parsed.data.dailyLimit })
    const saved = await db.$first(db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, current.id)))
    return externalConfigView(saved)
  })

  app.delete('/catalog/:key/configuration', { preHandler: requireAdmin }, async (request, reply) => {
    const key = (request.params as { key: string }).key
    const current = await db.$first(db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.workspaceId, request.auth.workspaceId), eq(externalConnectorConfigurations.connectorKey, key))))
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND', message: '连接器尚未配置。' })
    await db.delete(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, current.id))
    await audit(request.auth.workspaceId, request.auth.userId, 'external_connector.deleted', current.id, { connectorKey: key })
    return reply.code(204).send()
  })

  app.post('/connections', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const fallback = defaults[parsed.data.provider]
    if (parsed.data.category !== fallback.category) return reply.code(400).send({ error: 'INVALID_INPUT', message: '数据源类型与服务商不匹配。' })
    const endpoint = parsed.data.endpoint || fallback.endpoint
    if (!endpoint) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'SearXNG 必须填写实例地址。' })
    if (['brave', 'tavily', 'serpapi', 'google', 'bing', 'sam-gov', 'ungm'].includes(parsed.data.provider) && !parsed.data.secret) return reply.code(400).send({ error: 'INVALID_INPUT', message: `${fallback.name} 必须填写访问密钥或令牌。` })
    if (parsed.data.category === 'map' && !parsed.data.secret) return reply.code(400).send({ error: 'INVALID_INPUT', message: '地图服务必须填写访问密钥。' })
    try { await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: parsed.data.category === 'map' ? '地图服务地址' : '搜索服务地址' }) }
    catch (cause) { return reply.code(400).send({ error: 'UNSAFE_ENDPOINT', message: cause instanceof Error ? cause.message : '数据源地址不可用。' }) }
    const now = Date.now()
    const encrypted = parsed.data.secret ? encryptSecret(parsed.data.secret) : null
    const priority = parsed.data.priority ?? (((await db.$first(db.select({ max: sql<number>`coalesce(max(${integrationConnections.priority}), 0)` }).from(integrationConnections).where(and(eq(integrationConnections.workspaceId, request.auth.workspaceId), eq(integrationConnections.category, parsed.data.category)))))?.max ?? 0) + 1)
    const record = {
      id: createId('int'), workspaceId: request.auth.workspaceId, category: parsed.data.category, name: parsed.data.name || fallback.name,
      provider: parsed.data.provider, endpoint, priority, enabled: true, status: 'untested',
      secretCiphertext: encrypted?.ciphertext ?? null, secretIv: encrypted?.iv ?? null, secretTag: encrypted?.tag ?? null,
      secretEnding: parsed.data.secret ? parsed.data.secret.slice(-4).toUpperCase() : null,
      configJson: JSON.stringify({ resultLimit: parsed.data.resultLimit }), lastLatencyMs: null, lastError: null, lastTestedAt: null, createdAt: now, updatedAt: now,
    }
    try { await db.insert(integrationConnections).values(record) } catch { return reply.code(409).send({ error: 'CONNECTION_EXISTS', message: '已存在同名数据源连接。' }) }
    await audit(request.auth.workspaceId, request.auth.userId, 'integration.created', record.id, { category: record.category, provider: record.provider })
    return reply.code(201).send((await view(request.auth.workspaceId)).find(item => item.id === record.id))
  })

  app.patch('/connections/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = patchInput.safeParse(request.body)
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = (await db.$first(db.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '数据源连接不存在。' })
    const endpoint = parsed.data.endpoint ?? existing.endpoint
    try { await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: existing.category === 'map' ? '地图服务地址' : '搜索服务地址' }) }
    catch (cause) { return reply.code(400).send({ error: 'UNSAFE_ENDPOINT', message: cause instanceof Error ? cause.message : '数据源地址不可用。' }) }
    const { resultLimit, secret, ...fields } = parsed.data
    const encrypted = secret ? encryptSecret(secret) : null
    const currentConfig = safeJson<Record<string, unknown>>(existing.configJson, {})
    const requiresRetest = parsed.data.endpoint !== undefined || parsed.data.secret !== undefined || resultLimit !== undefined
    await db.update(integrationConnections).set({ ...fields, endpoint,
            ...(encrypted ? { secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretTag: encrypted.tag, secretEnding: secret!.slice(-4).toUpperCase() } : {}),
            configJson: JSON.stringify(resultLimit === undefined ? currentConfig : { ...currentConfig, resultLimit }),
            status: requiresRetest ? 'untested' : existing.status,
            lastError: requiresRetest ? null : existing.lastError,
            updatedAt: Date.now(),
          }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId)))
    await audit(request.auth.workspaceId, request.auth.userId, 'integration.updated', id, { fields: Object.keys(parsed.data).filter(key => key !== 'secret') })
    return (await view(request.auth.workspaceId)).find(item => item.id === id)
  })

  app.post('/connections/:id/test', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const connection = (await db.$first(db.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId)))))
    if (!connection) return reply.code(404).send({ error: 'NOT_FOUND', message: '数据源连接不存在。' })
    try {
      const result = connection.category === 'procurement'
        ? { items: await fetchProcurementOpportunities(connection.provider, { keywords: ['software'], regions: [], noticeTypes: [], limit: 1 }, connection), latencyMs: 0 }
        : connection.category === 'map'
          ? await discoverPlacesWithConnection(connection, 'business supplier', 'Shanghai', 3)
          : await searchWithConnection(connection, 'business supplier official website', 3)
      const now = Date.now()
      await db.update(integrationConnections).set({ status: 'available', lastLatencyMs: result.latencyMs, lastError: null, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, id))
      await audit(request.auth.workspaceId, request.auth.userId, 'integration.tested', id, { success: true, resultCount: result.items.length })
      return { ok: true, latencyMs: result.latencyMs, resultCount: result.items.length }
    } catch (cause) {
      const message = cause instanceof UnsafeUrlError ? cause.message : cause instanceof Error ? cause.message : '数据源测试失败。'
      const now = Date.now()
      await db.update(integrationConnections).set({ status: 'error', lastLatencyMs: null, lastError: message, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, id))
      await audit(request.auth.workspaceId, request.auth.userId, 'integration.tested', id, { success: false })
      return reply.code(502).send({ error: 'INTEGRATION_UNAVAILABLE', message })
    }
  })

  app.delete('/connections/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = (await db.$first(db.select({ id: integrationConnections.id }).from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '数据源连接不存在。' })
    await db.delete(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId)))
    await audit(request.auth.workspaceId, request.auth.userId, 'integration.deleted', id)
    return reply.code(204).send()
  })
}
