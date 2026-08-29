import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { customers, externalConnectorConfigurations, externalConnectorRuns } from '../db/schema.js'
import { decryptSecret } from '../lib/secret-vault.js'
import { recordCustomerTouchpoint } from '../leads/touchpoints.js'

const safeJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T } catch { return fallback } }
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const pick = (body: Record<string, unknown>, keys: string[]) => keys.map(key => text(body[key])).find(Boolean) || ''
const constantTimeMatch = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const externalConnectorWebhookRoutes: FastifyPluginAsync = async app => {
  app.post('/webhook/:id', async (request, reply) => {
    const rawBody = (request as typeof request & { rawBody?: Buffer }).rawBody
    const id = (request.params as { id: string }).id
    const connection = await db.$first(db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.id, id), eq(externalConnectorConfigurations.connectorKey, 'website-visitor-identification'), eq(externalConnectorConfigurations.enabled, true))))
    if (!connection?.credentialsCiphertext || !connection.credentialsIv || !connection.credentialsTag || !rawBody) return reply.code(403).send({ error: 'INVALID_CONNECTOR', message: '访客识别连接器不可用。' })
    const credentials = safeJson<Record<string, string>>(decryptSecret({ ciphertext: connection.credentialsCiphertext, iv: connection.credentialsIv, tag: connection.credentialsTag }), {})
    const signature = request.headers['x-sondara-signature']
    const expected = `sha256=${createHmac('sha256', credentials.webhookSecret || '').update(rawBody).digest('hex')}`
    if (typeof signature !== 'string' || !credentials.webhookSecret || !constantTimeMatch(signature, expected)) return reply.code(403).send({ error: 'INVALID_SIGNATURE', message: 'Webhook 签名验证失败。' })
    const payload = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {}
    const externalId = pick(payload, ['event_id', 'eventId', 'id']) || createHash('sha256').update(rawBody).digest('hex')
    const runId = `exr_${createHash('sha256').update(`${connection.workspaceId}:${connection.id}:${externalId}`).digest('hex').slice(0, 32)}`
    const now = Date.now()
    try { await db.insert(externalConnectorRuns).values({ id: runId, workspaceId: connection.workspaceId, configurationId: connection.id, connectorKey: connection.connectorKey, operation: 'webhook', status: 'running', inputJson: JSON.stringify({ externalId }), startedAt: now }) }
    catch { return { ok: true, duplicate: true } }
    const company = pick(payload, ['company', 'company_name', 'organization', 'organization_name'])
    const domain = pick(payload, ['domain', 'website', 'company_domain'])
    const matched = company
      ? await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, connection.workspaceId), sql`lower(${customers.company}) = ${company.toLowerCase()}`)))
      : domain ? await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, connection.workspaceId), sql`lower(${customers.source}) like ${`%${domain.toLowerCase()}%`}`))) : undefined
    if (!matched) {
      await db.update(externalConnectorRuns).set({ status: 'completed', fetchedCount: 1, skippedCount: 1, error: '未匹配到已有企业，未自动创建弱意向客户。', completedAt: now }).where(eq(externalConnectorRuns.id, runId))
      return reply.code(202).send({ ok: true, accepted: true, matched: false })
    }
    await db.update(customers).set({ signal: '网站访客企业识别', interaction: pick(payload, ['page_title', 'page', 'path']) || '企业访问网站', updatedAt: now }).where(eq(customers.id, matched.id))
    await recordCustomerTouchpoint({ workspaceId: connection.workspaceId, customerId: matched.id, eventType: 'website_visit_identified', source: connection.name, medium: 'website', referrer: pick(payload, ['referrer']), landingPage: pick(payload, ['url', 'page_url']), externalId, metadata: { company, domain, provider: safeJson<Record<string, string>>(connection.settingsJson, {}).providerName } })
    await db.update(externalConnectorRuns).set({ status: 'completed', fetchedCount: 1, updatedCount: 1, completedAt: now }).where(eq(externalConnectorRuns.id, runId))
    await db.update(externalConnectorConfigurations).set({ status: 'available', lastError: null, lastValidatedAt: now, updatedAt: now }).where(eq(externalConnectorConfigurations.id, connection.id))
    return { ok: true, accepted: true, matched: true, customerId: matched.id }
  })
}
