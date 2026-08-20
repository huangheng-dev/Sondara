import type { FastifyPluginAsync } from 'fastify'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { aiServiceKeys, aiServices, auditLogs, workspaceAiPolicies } from '../db/schema.js'
import { AiUnavailableError, completeWithAi } from '../ai/client.js'
import { createId } from '../lib/ids.js'
import { encryptSecret } from '../lib/secret-vault.js'
import { requireAdmin, requireAuth } from '../plugins/auth.js'

const provider = z.enum(['deepseek', 'dashscope', 'openai-compatible'])
const defaults = {
  deepseek: { endpoint: 'https://api.deepseek.com', model: 'deepseek-v4-flash' },
  dashscope: { endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  'openai-compatible': { endpoint: '', model: '' },
} as const

const serviceInput = z.object({
  name: z.string().trim().min(1).max(120),
  provider,
  model: z.string().trim().max(120).optional(),
  endpoint: z.string().trim().url().optional(),
  priority: z.number().int().min(1).max(100).optional(),
})
const servicePatch = z.object({ enabled: z.boolean().optional(), priority: z.number().int().min(1).max(100).optional(), name: z.string().trim().min(1).max(120).optional(), model: z.string().trim().min(1).max(120).optional(), endpoint: z.string().trim().url().optional() })
const keyInput = z.object({ name: z.string().trim().min(1).max(120), secret: z.string().trim().min(8).max(500) })
const keyPatch = z.object({ enabled: z.boolean() })
const policyInput = z.object({
  rotationStrategy: z.enum(['failover', 'round-robin', 'least-used']),
  retryCount: z.number().int().min(0).max(3),
  retryBackoff: z.enum(['exponential', 'fixed']),
  retryDelayMs: z.number().int().min(250).max(30_000),
  cooldownMs: z.number().int().min(60_000).max(24 * 60 * 60_000),
  failoverEnabled: z.boolean(),
})
const defaultPolicy = { rotationStrategy: 'failover' as const, retryCount: 2, retryBackoff: 'exponential' as const, retryDelayMs: 1000, cooldownMs: 300_000, failoverEnabled: true }

const audit = async (workspaceId: string, actorUserId: string, action: string, entityType: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType, entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

const serviceView = async (workspaceId: string) => (await db.select({
  id: aiServices.id, workspaceId: aiServices.workspaceId, name: aiServices.name, provider: aiServices.provider,
  model: aiServices.model, endpoint: aiServices.endpoint, priority: aiServices.priority, enabled: aiServices.enabled,
  status: aiServices.status, lastLatencyMs: aiServices.lastLatencyMs, lastError: aiServices.lastError,
  lastTestedAt: aiServices.lastTestedAt, createdAt: aiServices.createdAt, updatedAt: aiServices.updatedAt,
  keyCount: sql<number>`(select count(*) from ${aiServiceKeys} where ${aiServiceKeys.serviceId} = ${aiServices.id})`,
}).from(aiServices).where(eq(aiServices.workspaceId, workspaceId)).orderBy(asc(aiServices.priority)))

export const aiServiceRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/services', async request => ({ items: (await serviceView(request.auth.workspaceId)) }))

  app.get('/policy', async request => {
    const policy = (await db.$first(db.select().from(workspaceAiPolicies).where(eq(workspaceAiPolicies.workspaceId, request.auth.workspaceId))))
    return policy ?? { workspaceId: request.auth.workspaceId, ...defaultPolicy, updatedAt: null }
  })

  app.patch('/policy', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = policyInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const record = { workspaceId: request.auth.workspaceId, ...parsed.data, updatedAt: Date.now() }
    await db.insert(workspaceAiPolicies).values(record).onConflictDoUpdate({
            target: workspaceAiPolicies.workspaceId,
            set: { ...parsed.data, updatedAt: record.updatedAt },
          })
    await audit(request.auth.workspaceId, request.auth.userId, 'ai.policy.updated', 'workspace_ai_policy', request.auth.workspaceId, parsed.data)
    return record
  })

  app.post('/services', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = serviceInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const fallback = defaults[parsed.data.provider]
    const endpoint = parsed.data.endpoint || fallback.endpoint
    const model = parsed.data.model || fallback.model
    if (!endpoint || !model) return reply.code(400).send({ error: 'INVALID_INPUT', message: '兼容服务必须填写接口地址和模型名称。' })
    const now = Date.now()
    const nextPriority = parsed.data.priority ?? (((await db.$first(db.select({ max: sql<number>`coalesce(max(${aiServices.priority}), 0)` }).from(aiServices).where(eq(aiServices.workspaceId, request.auth.workspaceId))))?.max ?? 0) + 1)
    const record = { id: createId('ais'), workspaceId: request.auth.workspaceId, name: parsed.data.name, provider: parsed.data.provider, model, endpoint, priority: nextPriority, enabled: true, status: 'untested', lastLatencyMs: null, lastError: null, lastTestedAt: null, createdAt: now, updatedAt: now }
    try { await db.insert(aiServices).values(record) } catch { return reply.code(409).send({ error: 'SERVICE_EXISTS', message: '已存在同名 AI 服务。' }) }
    await audit(request.auth.workspaceId, request.auth.userId, 'ai.service.created', 'ai_service', record.id, { provider: record.provider, model: record.model })
    return reply.code(201).send({ ...record, keyCount: 0 })
  })

  app.patch('/services/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = servicePatch.safeParse(request.body)
    if (!parsed.success || !Object.keys(parsed.data).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = (await db.$first(db.select().from(aiServices).where(and(eq(aiServices.id, id), eq(aiServices.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: 'AI 服务不存在。' })
    await db.update(aiServices).set({ ...parsed.data, updatedAt: Date.now() }).where(and(eq(aiServices.id, id), eq(aiServices.workspaceId, request.auth.workspaceId)))
    await audit(request.auth.workspaceId, request.auth.userId, 'ai.service.updated', 'ai_service', id, { fields: Object.keys(parsed.data) })
    return (await serviceView(request.auth.workspaceId)).find(item => item.id === id)
  })

  app.get('/services/:id/keys', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const service = (await db.$first(db.select({ id: aiServices.id }).from(aiServices).where(and(eq(aiServices.id, id), eq(aiServices.workspaceId, request.auth.workspaceId)))))
    if (!service) return reply.code(404).send({ error: 'NOT_FOUND', message: 'AI 服务不存在。' })
    const items = (await db.select({ id: aiServiceKeys.id, serviceId: aiServiceKeys.serviceId, name: aiServiceKeys.name, ending: aiServiceKeys.ending, enabled: aiServiceKeys.enabled, failureCount: aiServiceKeys.failureCount, cooldownUntil: aiServiceKeys.cooldownUntil, lastUsedAt: aiServiceKeys.lastUsedAt, createdAt: aiServiceKeys.createdAt, updatedAt: aiServiceKeys.updatedAt }).from(aiServiceKeys).where(and(eq(aiServiceKeys.serviceId, id), eq(aiServiceKeys.workspaceId, request.auth.workspaceId))).orderBy(asc(aiServiceKeys.createdAt)))
    return { items }
  })

  app.post('/services/:id/keys', { preHandler: requireAdmin }, async (request, reply) => {
    const serviceId = (request.params as { id: string }).id
    const parsed = keyInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const service = (await db.$first(db.select({ id: aiServices.id }).from(aiServices).where(and(eq(aiServices.id, serviceId), eq(aiServices.workspaceId, request.auth.workspaceId)))))
    if (!service) return reply.code(404).send({ error: 'NOT_FOUND', message: 'AI 服务不存在。' })
    const encrypted = encryptSecret(parsed.data.secret)
    const now = Date.now()
    const record = { id: createId('aik'), workspaceId: request.auth.workspaceId, serviceId, name: parsed.data.name, secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretTag: encrypted.tag, ending: parsed.data.secret.slice(-4).toUpperCase(), enabled: true, failureCount: 0, cooldownUntil: null, lastUsedAt: null, createdAt: now, updatedAt: now }
    await db.insert(aiServiceKeys).values(record)
    await audit(request.auth.workspaceId, request.auth.userId, 'ai.key.created', 'ai_service_key', record.id, { serviceId, ending: record.ending })
    return reply.code(201).send({ id: record.id, serviceId, name: record.name, ending: record.ending, enabled: true, failureCount: 0, cooldownUntil: null, lastUsedAt: null, createdAt: now, updatedAt: now })
  })

  app.patch('/keys/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = keyPatch.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const key = (await db.$first(db.select().from(aiServiceKeys).where(and(eq(aiServiceKeys.id, id), eq(aiServiceKeys.workspaceId, request.auth.workspaceId)))))
    if (!key) return reply.code(404).send({ error: 'NOT_FOUND', message: '密钥不存在。' })
    await db.update(aiServiceKeys).set({ enabled: parsed.data.enabled, updatedAt: Date.now() }).where(eq(aiServiceKeys.id, id))
    await audit(request.auth.workspaceId, request.auth.userId, 'ai.key.updated', 'ai_service_key', id, { enabled: parsed.data.enabled })
    return { id, enabled: parsed.data.enabled }
  })

  app.delete('/keys/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const key = (await db.$first(db.select({ id: aiServiceKeys.id, serviceId: aiServiceKeys.serviceId, ending: aiServiceKeys.ending }).from(aiServiceKeys).where(and(eq(aiServiceKeys.id, id), eq(aiServiceKeys.workspaceId, request.auth.workspaceId)))))
    if (!key) return reply.code(404).send({ error: 'NOT_FOUND', message: '密钥不存在。' })
    await db.delete(aiServiceKeys).where(and(eq(aiServiceKeys.id, id), eq(aiServiceKeys.workspaceId, request.auth.workspaceId)))
    await audit(request.auth.workspaceId, request.auth.userId, 'ai.key.deleted', 'ai_service_key', id, { serviceId: key.serviceId, ending: key.ending })
    return reply.code(204).send()
  })

  app.post('/services/:id/test', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const service = (await db.$first(db.select().from(aiServices).where(and(eq(aiServices.id, id), eq(aiServices.workspaceId, request.auth.workspaceId)))))
    if (!service) return reply.code(404).send({ error: 'NOT_FOUND', message: 'AI 服务不存在。' })
    try {
      const result = await completeWithAi({ workspaceId: request.auth.workspaceId, serviceId: id, messages: [{ role: 'user', content: '只回复 OK' }], maxTokens: 8, temperature: 0 })
      await audit(request.auth.workspaceId, request.auth.userId, 'ai.service.tested', 'ai_service', id, { success: true, latency: result.latencyMs })
      return { ok: true, latencyMs: result.latencyMs }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '连接失败'
      await audit(request.auth.workspaceId, request.auth.userId, 'ai.service.tested', 'ai_service', id, { success: false })
      if (cause instanceof AiUnavailableError && cause.code === 'NO_CONFIGURATION') return reply.code(409).send({ error: 'NO_ACTIVE_KEY', message })
      return reply.code(502).send({ error: 'AI_SERVICE_UNAVAILABLE', message })
    }
  })
}
