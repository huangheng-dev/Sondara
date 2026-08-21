import { createHash, randomBytes } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { auditLogs, leadSourceConnections, leadSourceEvents } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { encryptSecret } from '../lib/secret-vault.js'
import { hashSessionToken } from '../lib/session.js'
import { requireAdmin, requireAuth } from '../plugins/auth.js'

const provider = z.enum(['linkedin-lead-gen', 'meta-lead-ads'])
const connectionInput = z.object({ name: z.string().trim().min(2).max(120), provider, accountRef: z.string().trim().max(200).optional(), formRef: z.string().trim().max(200).optional(), clientId: z.string().trim().max(300).optional(), accessToken: z.string().trim().max(2000).optional(), enabled: z.boolean().default(true) })
const patchInput = connectionInput.partial().refine(value => Object.keys(value).length > 0)
const parseMetadata = (value: string) => { try { return JSON.parse(value) as Record<string, unknown> } catch { return {} } }
const view = (item: typeof leadSourceConnections.$inferSelect) => ({ id: item.id, provider: item.provider, name: item.name, accountRef: item.accountRef, formRef: item.formRef, clientId: item.clientId, enabled: item.enabled, status: item.status, hasAccessToken: Boolean(item.accessTokenCiphertext), accessTokenEnding: item.accessTokenEnding, lastError: item.lastError, lastSyncedAt: item.lastSyncedAt, createdAt: item.createdAt, updatedAt: item.updatedAt, webhookPath: `/api/lead-sources/webhook/${item.id}` })
const audit = async (workspaceId: string, actorUserId: string | null, action: string, entityId: string, metadata: Record<string, unknown> = {}) => db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'lead_source', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
const webhookToken = (request: { query: unknown; headers: Record<string, unknown> }) => {
  const query = request.query as Record<string, unknown>
  const fromQuery = query.token ?? query['hub.verify_token']
  const fromHeader = request.headers['x-sondara-lead-token']
  return typeof fromQuery === 'string' ? fromQuery : typeof fromHeader === 'string' ? fromHeader : ''
}

export const leadSourceRoutes: FastifyPluginAsync = async app => {
  app.get('/connections', { preHandler: requireAuth }, async request => ({ items: (await db.select().from(leadSourceConnections).where(eq(leadSourceConnections.workspaceId, request.auth.workspaceId)).orderBy(desc(leadSourceConnections.createdAt))).map(view) }))

  app.post('/connections', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = connectionInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now(); const id = createId('lsc'); const token = randomBytes(32).toString('base64url'); const encrypted = parsed.data.accessToken ? encryptSecret(parsed.data.accessToken) : null
    const record = { id, workspaceId: request.auth.workspaceId, provider: parsed.data.provider, name: parsed.data.name, accountRef: parsed.data.accountRef ?? null, formRef: parsed.data.formRef ?? null, clientId: parsed.data.clientId ?? null, accessTokenCiphertext: encrypted?.ciphertext ?? null, accessTokenIv: encrypted?.iv ?? null, accessTokenTag: encrypted?.tag ?? null, accessTokenEnding: parsed.data.accessToken?.slice(-4).toUpperCase() ?? null, webhookTokenHash: hashSessionToken(token), enabled: parsed.data.enabled, status: parsed.data.accessToken ? 'ready_for_authorization' : 'not_configured', lastError: null, lastSyncedAt: null, createdAt: now, updatedAt: now }
    try { await db.insert(leadSourceConnections).values(record) } catch { return reply.code(409).send({ error: 'CONNECTION_EXISTS', message: '已存在同名线索来源连接。' }) }
    await audit(request.auth.workspaceId, request.auth.userId, 'lead_source.created', id, { provider: record.provider })
    return reply.code(201).send({ ...view(record), webhookUrl: `${config.webOrigin.replace(/\/$/, '')}/api/lead-sources/webhook/${id}?token=${encodeURIComponent(token)}`, webhookToken: token })
  })

  app.patch('/connections/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = patchInput.safeParse(request.body); const id = (request.params as { id: string }).id
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '线索来源连接不存在。' })
    const { accessToken, ...fields } = parsed.data; const encrypted = accessToken ? encryptSecret(accessToken) : null
    await db.update(leadSourceConnections).set({ ...fields, ...(encrypted ? { accessTokenCiphertext: encrypted.ciphertext, accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag, accessTokenEnding: accessToken!.slice(-4).toUpperCase(), status: 'ready_for_authorization', lastError: null } : {}), updatedAt: Date.now() }).where(eq(leadSourceConnections.id, id))
    await audit(request.auth.workspaceId, request.auth.userId, 'lead_source.updated', id, { fields: Object.keys(parsed.data).filter(key => key !== 'accessToken') })
    return view((await db.$first(db.select().from(leadSourceConnections).where(eq(leadSourceConnections.id, id))))!)
  })

  app.post('/connections/:id/regenerate-webhook', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.workspaceId, request.auth.workspaceId))))
    if (!connection) return reply.code(404).send({ error: 'NOT_FOUND', message: '线索来源连接不存在。' })
    const token = randomBytes(32).toString('base64url')
    await db.update(leadSourceConnections).set({ webhookTokenHash: hashSessionToken(token), updatedAt: Date.now() }).where(eq(leadSourceConnections.id, id))
    await audit(request.auth.workspaceId, request.auth.userId, 'lead_source.webhook_rotated', id)
    return { webhookUrl: `${config.webOrigin.replace(/\/$/, '')}/api/lead-sources/webhook/${id}?token=${encodeURIComponent(token)}`, webhookToken: token }
  })

  app.get('/events', { preHandler: requireAdmin }, async request => ({ items: (await db.select().from(leadSourceEvents).where(eq(leadSourceEvents.workspaceId, request.auth.workspaceId)).orderBy(desc(leadSourceEvents.receivedAt)).limit(200)).map(item => ({ ...item, payload: parseMetadata(item.payloadJson) })) }))

  app.get('/webhook/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id; const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.enabled, true))))
    if (!connection || !webhookToken(request) || hashSessionToken(webhookToken(request)) !== connection.webhookTokenHash) return reply.code(403).send({ error: 'INVALID_WEBHOOK_TOKEN', message: 'Webhook 验证失败。' })
    const query = request.query as Record<string, unknown>; const challenge = query['hub.challenge']
    if (typeof challenge === 'string') return reply.type('text/plain').send(challenge)
    return { ok: true, provider: connection.provider }
  })

  app.post('/webhook/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id; const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.enabled, true))))
    if (!connection || !webhookToken(request) || hashSessionToken(webhookToken(request)) !== connection.webhookTokenHash) return reply.code(403).send({ error: 'INVALID_WEBHOOK_TOKEN', message: 'Webhook 验证失败。' })
    const payload = request.body ?? {}; const data = payload as Record<string, unknown>; const eventId = typeof data.id === 'string' ? data.id : typeof data.leadgen_id === 'string' ? data.leadgen_id : createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    const now = Date.now()
    try { await db.insert(leadSourceEvents).values({ id: createId('lse'), workspaceId: connection.workspaceId, connectionId: connection.id, providerEventId: eventId.slice(0, 200), payloadJson: JSON.stringify(payload), processingStatus: 'received', processingError: null, receivedAt: now, processedAt: null }) }
    catch { return { ok: true, duplicate: true } }
    await db.update(leadSourceConnections).set({ status: 'webhook_received', lastError: null, lastSyncedAt: now, updatedAt: now }).where(eq(leadSourceConnections.id, connection.id))
    await audit(connection.workspaceId, null, 'lead_source.event_received', connection.id, { provider: connection.provider, eventId: eventId.slice(0, 100) })
    return { ok: true, accepted: true }
  })
}
