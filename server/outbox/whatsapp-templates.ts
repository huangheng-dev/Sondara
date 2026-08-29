import { and, eq } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { outboundChannelConnections, whatsappMessageTemplates } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { decryptSecret } from '../lib/secret-vault.js'
import { assertSafeOutboundUrl } from '../lib/url-safety.js'

type Connection = typeof outboundChannelConnections.$inferSelect
type JsonObject = Record<string, unknown>
const asObject = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''

const accessTokenFor = (connection: Connection) => decryptSecret({
  ciphertext: connection.secretCiphertext,
  iv: connection.secretIv,
  tag: connection.secretTag,
})

export const serializeWhatsappTemplate = (item: typeof whatsappMessageTemplates.$inferSelect) => ({
  ...item,
  components: (() => { try { return JSON.parse(item.componentsJson) as unknown[] } catch { return [] } })(),
})

export const syncWhatsappTemplates = async (connection: Connection, fetcher: typeof fetch = fetch) => {
  if (connection.provider !== 'whatsapp-cloud') throw new Error('只有 WhatsApp Cloud API 连接可以同步模板。')
  if (!connection.whatsappBusinessAccountId) throw new Error('请先配置 WhatsApp Business Account ID。')
  const token = accessTokenFor(connection)
  let next: string | null = `https://graph.facebook.com/${config.metaGraphApiVersion}/${encodeURIComponent(connection.whatsappBusinessAccountId)}/message_templates?fields=id,name,language,status,category,components,quality_score,rejected_reason&limit=100`
  const templates: JsonObject[] = []
  for (let page = 0; next && page < 20; page += 1) {
    await assertSafeOutboundUrl(next, { allowPrivate: false, label: 'WhatsApp 模板 API 地址' })
    const response = await fetcher(next, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
    const payload = asObject(await response.json().catch(() => ({})))
    if (!response.ok) throw new Error(scalar(asObject(payload.error).message) || `WhatsApp 模板同步失败（HTTP ${response.status}）。`)
    templates.push(...(Array.isArray(payload.data) ? payload.data.map(asObject) : []))
    next = scalar(asObject(payload.paging).next) || null
  }
  const now = Date.now()
  for (const template of templates) {
    const name = scalar(template.name)
    const language = scalar(template.language)
    if (!name || !language) continue
    const quality = template.quality_score === undefined ? null : typeof template.quality_score === 'string' ? template.quality_score : JSON.stringify(template.quality_score)
    await db.insert(whatsappMessageTemplates).values({
      id: createId('wmt'), workspaceId: connection.workspaceId, connectionId: connection.id,
      externalId: scalar(template.id) || null, name, language,
      category: scalar(template.category) || 'UNKNOWN', status: scalar(template.status) || 'PENDING',
      qualityScore: quality, rejectedReason: scalar(template.rejected_reason) || null,
      componentsJson: JSON.stringify(Array.isArray(template.components) ? template.components : []),
      lastSyncedAt: now, createdAt: now, updatedAt: now,
    }).onConflictDoUpdate({
      target: [whatsappMessageTemplates.connectionId, whatsappMessageTemplates.name, whatsappMessageTemplates.language],
      set: { externalId: scalar(template.id) || null, category: scalar(template.category) || 'UNKNOWN', status: scalar(template.status) || 'PENDING', qualityScore: quality, rejectedReason: scalar(template.rejected_reason) || null, componentsJson: JSON.stringify(Array.isArray(template.components) ? template.components : []), lastSyncedAt: now, updatedAt: now },
    })
  }
  return (await db.select().from(whatsappMessageTemplates).where(and(eq(whatsappMessageTemplates.workspaceId, connection.workspaceId), eq(whatsappMessageTemplates.connectionId, connection.id)))).map(serializeWhatsappTemplate)
}

export const buildWhatsappMessagePayload = ({ connection, to, body }: { connection: Connection; to: string; body: string }) => {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/[^0-9]/g, '') }
  if (connection.whatsappDefaultTemplateName) {
    return {
      ...base,
      type: 'template',
      template: {
        name: connection.whatsappDefaultTemplateName,
        language: { code: connection.whatsappDefaultTemplateLanguage || 'en_US' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: body }] }],
      },
    }
  }
  return { ...base, type: 'text', text: { preview_url: false, body } }
}
