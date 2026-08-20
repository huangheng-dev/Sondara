import type { FastifyPluginAsync } from 'fastify'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { auditLogs, integrationConnections } from '../db/schema.js'
import { discoverPlacesWithConnection } from '../integrations/map-client.js'
import { searchWithConnection } from '../integrations/search-client.js'
import { createId } from '../lib/ids.js'
import { encryptSecret } from '../lib/secret-vault.js'
import { assertSafeOutboundUrl, UnsafeUrlError } from '../lib/url-safety.js'
import { requireAdmin, requireAuth } from '../plugins/auth.js'

const provider = z.enum(['brave', 'tavily', 'serpapi', 'google', 'bing', 'searxng', 'google-places'])
const category = z.enum(['search', 'map'])
const defaults = {
  brave: { category: 'search', name: 'Brave Search', endpoint: 'https://api.search.brave.com/res/v1/web/search' },
  tavily: { category: 'search', name: 'Tavily Search', endpoint: 'https://api.tavily.com/search' },
  serpapi: { category: 'search', name: 'SerpAPI', endpoint: 'https://serpapi.com/search' },
  google: { category: 'search', name: 'Google Custom Search', endpoint: 'https://www.googleapis.com/customsearch/v1' },
  bing: { category: 'search', name: 'Bing Web Search', endpoint: 'https://api.bing.microsoft.com/v7.0/search' },
  searxng: { category: 'search', name: 'SearXNG', endpoint: '' },
  'google-places': { category: 'map', name: 'Google Places', endpoint: 'https://places.googleapis.com/v1/places:searchText' },
} as const
const createInput = z.object({
  category: category.default('search'), name: z.string().trim().max(120).optional(), provider,
  endpoint: z.string().trim().url().optional(), secret: z.string().trim().max(500).optional(),
  priority: z.number().int().min(1).max(100).optional(), resultLimit: z.number().int().min(1).max(20).default(10),
})
const patchInput = z.object({ name: z.string().trim().min(1).max(120).optional(), endpoint: z.string().trim().url().optional(), secret: z.string().trim().max(500).optional(), priority: z.number().int().min(1).max(100).optional(), enabled: z.boolean().optional(), resultLimit: z.number().int().min(1).max(20).optional() })

const safeJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T } catch { return fallback } }
const view = (workspaceId: string) => db.select().from(integrationConnections).where(eq(integrationConnections.workspaceId, workspaceId)).orderBy(asc(integrationConnections.category), asc(integrationConnections.priority)).all().map(item => ({
  id: item.id, workspaceId: item.workspaceId, category: item.category, name: item.name, provider: item.provider, endpoint: item.endpoint,
  priority: item.priority, enabled: item.enabled, status: item.status, secretEnding: item.secretEnding, hasSecret: Boolean(item.secretCiphertext),
  config: safeJson(item.configJson, {}), lastLatencyMs: item.lastLatencyMs, lastError: item.lastError, lastTestedAt: item.lastTestedAt,
  createdAt: item.createdAt, updatedAt: item.updatedAt,
}))
const audit = (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'integration_connection', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() }).run()

export const integrationRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)
  app.get('/connections', async request => ({ items: view(request.auth.workspaceId) }))

  app.post('/connections', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const fallback = defaults[parsed.data.provider]
    if (parsed.data.category !== fallback.category) return reply.code(400).send({ error: 'INVALID_INPUT', message: '数据源类型与服务商不匹配。' })
    const endpoint = parsed.data.endpoint || fallback.endpoint
    if (!endpoint) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'SearXNG 必须填写实例地址。' })
    if (['brave', 'tavily', 'serpapi', 'google', 'bing'].includes(parsed.data.provider) && !parsed.data.secret) return reply.code(400).send({ error: 'INVALID_INPUT', message: `${fallback.name} 必须填写访问密钥。` })
    if (parsed.data.category === 'map' && !parsed.data.secret) return reply.code(400).send({ error: 'INVALID_INPUT', message: '地图服务必须填写访问密钥。' })
    try { await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: parsed.data.category === 'map' ? '地图服务地址' : '搜索服务地址' }) }
    catch (cause) { return reply.code(400).send({ error: 'UNSAFE_ENDPOINT', message: cause instanceof Error ? cause.message : '数据源地址不可用。' }) }
    const now = Date.now()
    const encrypted = parsed.data.secret ? encryptSecret(parsed.data.secret) : null
    const priority = parsed.data.priority ?? ((db.select({ max: sql<number>`coalesce(max(${integrationConnections.priority}), 0)` }).from(integrationConnections).where(and(eq(integrationConnections.workspaceId, request.auth.workspaceId), eq(integrationConnections.category, parsed.data.category))).get()?.max ?? 0) + 1)
    const record = {
      id: createId('int'), workspaceId: request.auth.workspaceId, category: parsed.data.category, name: parsed.data.name || fallback.name,
      provider: parsed.data.provider, endpoint, priority, enabled: true, status: 'untested',
      secretCiphertext: encrypted?.ciphertext ?? null, secretIv: encrypted?.iv ?? null, secretTag: encrypted?.tag ?? null,
      secretEnding: parsed.data.secret ? parsed.data.secret.slice(-4).toUpperCase() : null,
      configJson: JSON.stringify({ resultLimit: parsed.data.resultLimit }), lastLatencyMs: null, lastError: null, lastTestedAt: null, createdAt: now, updatedAt: now,
    }
    try { db.insert(integrationConnections).values(record).run() } catch { return reply.code(409).send({ error: 'CONNECTION_EXISTS', message: '已存在同名数据源连接。' }) }
    audit(request.auth.workspaceId, request.auth.userId, 'integration.created', record.id, { category: record.category, provider: record.provider })
    return reply.code(201).send(view(request.auth.workspaceId).find(item => item.id === record.id))
  })

  app.patch('/connections/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = patchInput.safeParse(request.body)
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = db.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId))).get()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '数据源连接不存在。' })
    const endpoint = parsed.data.endpoint ?? existing.endpoint
    try { await assertSafeOutboundUrl(endpoint, { allowPrivate: config.allowPrivateConnectors, label: existing.category === 'map' ? '地图服务地址' : '搜索服务地址' }) }
    catch (cause) { return reply.code(400).send({ error: 'UNSAFE_ENDPOINT', message: cause instanceof Error ? cause.message : '数据源地址不可用。' }) }
    const { resultLimit, secret, ...fields } = parsed.data
    const encrypted = secret ? encryptSecret(secret) : null
    const currentConfig = safeJson<Record<string, unknown>>(existing.configJson, {})
    const requiresRetest = parsed.data.endpoint !== undefined || parsed.data.secret !== undefined || resultLimit !== undefined
    db.update(integrationConnections).set({ ...fields, endpoint,
      ...(encrypted ? { secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretTag: encrypted.tag, secretEnding: secret!.slice(-4).toUpperCase() } : {}),
      configJson: JSON.stringify(resultLimit === undefined ? currentConfig : { ...currentConfig, resultLimit }),
      status: requiresRetest ? 'untested' : existing.status,
      lastError: requiresRetest ? null : existing.lastError,
      updatedAt: Date.now(),
    }).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId))).run()
    audit(request.auth.workspaceId, request.auth.userId, 'integration.updated', id, { fields: Object.keys(parsed.data).filter(key => key !== 'secret') })
    return view(request.auth.workspaceId).find(item => item.id === id)
  })

  app.post('/connections/:id/test', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const connection = db.select().from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId))).get()
    if (!connection) return reply.code(404).send({ error: 'NOT_FOUND', message: '数据源连接不存在。' })
    try {
      const result = connection.category === 'map'
        ? await discoverPlacesWithConnection(connection, 'industrial equipment manufacturer', 'Shanghai', 3)
        : await searchWithConnection(connection, 'industrial equipment manufacturer official website', 3)
      const now = Date.now()
      db.update(integrationConnections).set({ status: 'available', lastLatencyMs: result.latencyMs, lastError: null, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, id)).run()
      audit(request.auth.workspaceId, request.auth.userId, 'integration.tested', id, { success: true, resultCount: result.items.length })
      return { ok: true, latencyMs: result.latencyMs, resultCount: result.items.length }
    } catch (cause) {
      const message = cause instanceof UnsafeUrlError ? cause.message : cause instanceof Error ? cause.message : '数据源测试失败。'
      const now = Date.now()
      db.update(integrationConnections).set({ status: 'error', lastLatencyMs: null, lastError: message, lastTestedAt: now, updatedAt: now }).where(eq(integrationConnections.id, id)).run()
      audit(request.auth.workspaceId, request.auth.userId, 'integration.tested', id, { success: false })
      return reply.code(502).send({ error: 'INTEGRATION_UNAVAILABLE', message })
    }
  })

  app.delete('/connections/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = db.select({ id: integrationConnections.id }).from(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId))).get()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '数据源连接不存在。' })
    db.delete(integrationConnections).where(and(eq(integrationConnections.id, id), eq(integrationConnections.workspaceId, request.auth.workspaceId))).run()
    audit(request.auth.workspaceId, request.auth.userId, 'integration.deleted', id)
    return reply.code(204).send()
  })
}
