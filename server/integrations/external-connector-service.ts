import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { auditLogs, externalConnectorConfigurations, externalConnectorRuns, inboxContacts } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { decryptSecret } from '../lib/secret-vault.js'
import { applyConnectorRecords, executeExternalConnector } from './external-connector-runtime.js'
import { connectorCatalogByKey } from './connector-catalog.js'
import { syncHubspotCrmObjects } from './hubspot-crm-sync.js'

type Configuration = typeof externalConnectorConfigurations.$inferSelect
const safeJson = <T>(value: string, fallback: T): T => { try { return JSON.parse(value) as T } catch { return fallback } }
const credentialsFor = (item: Configuration) => item.credentialsCiphertext && item.credentialsIv && item.credentialsTag
  ? safeJson<Record<string, string>>(decryptSecret({ ciphertext: item.credentialsCiphertext, iv: item.credentialsIv, tag: item.credentialsTag }), {}) : {}
const audit = async (item: Configuration, actorUserId: string | null, action: string, metadata: unknown) => db.insert(auditLogs).values({ id: createId('aud'), workspaceId: item.workspaceId, actorUserId, action, entityType: 'integration_connection', entityId: item.id, metadata: JSON.stringify(metadata), createdAt: Date.now() })

export class ExternalConnectorRunError extends Error {
  constructor(message: string, public runId: string | null = null) { super(message); this.name = 'ExternalConnectorRunError' }
}

export const runConfiguredExternalConnector = async (input: {
  configuration: Configuration
  actorUserId?: string | null
  query?: string
  cursor?: string | null
  limit?: number
  importRecords?: boolean
  scheduled?: boolean
}) => {
  const current = input.configuration
  if (!current.enabled) throw new ExternalConnectorRunError('连接器已停用。')
  if (current.connectorKey === 'website-visitor-identification') throw new ExternalConnectorRunError('网站访客识别通过签名 Webhook 接收入站事件。')
  const settings = safeJson<Record<string, string>>(current.settingsJson, {})
  const credentials = credentialsFor(current)
  const catalog = connectorCatalogByKey.get(current.connectorKey)
  const missing = catalog?.fields.find(field => field.required && !(field.secret ? credentials[field.key] : settings[field.key]))
  if (missing) throw new ExternalConnectorRunError(`缺少${missing.label}。`)
  const query = input.query ?? (input.scheduled ? current.scheduleQuery || undefined : undefined)
  if (['company-contact-database', 'trade-supply-chain-data', 'vertical-industry-database'].includes(current.connectorKey) && !query) throw new ExternalConnectorRunError('该连接器运行前需要搜索关键词。')
  let limit = Math.min(input.limit ?? current.perRunLimit, current.perRunLimit)
  if (input.scheduled) {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
    const used = Number((await db.$first(db.select({ total: sql<number>`coalesce(sum(${externalConnectorRuns.fetchedCount}), 0)` }).from(externalConnectorRuns).where(and(eq(externalConnectorRuns.configurationId, current.id), eq(externalConnectorRuns.status, 'completed'), gte(externalConnectorRuns.startedAt, dayStart.getTime())))))?.total ?? 0)
    const remaining = current.dailyLimit - used
    if (remaining <= 0) {
      const tomorrow = dayStart.getTime() + 86_400_000
      await db.update(externalConnectorConfigurations).set({ status: 'quota_reached', nextRunAt: tomorrow, pausedReason: '已达到每日调用上限，明日自动恢复。', updatedAt: Date.now() }).where(eq(externalConnectorConfigurations.id, current.id))
      throw new ExternalConnectorRunError('已达到每日调用上限。')
    }
    limit = Math.min(limit, remaining)
  }
  const runId = createId('exr'); const startedAt = Date.now(); const importRecords = input.importRecords ?? true
  await db.insert(externalConnectorRuns).values({ id: runId, workspaceId: current.workspaceId, configurationId: current.id, connectorKey: current.connectorKey, operation: input.scheduled ? 'scheduled_sync' : importRecords ? 'sync' : 'test', status: 'running', inputJson: JSON.stringify({ query, limit, scheduled: Boolean(input.scheduled) }), cursor: input.cursor ?? current.cursor, startedAt })
  try {
    const values = ['email-verification', 'phone-verification'].includes(current.connectorKey)
      ? (await db.select({ id: inboxContacts.id, email: inboxContacts.email, phone: inboxContacts.phone }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, current.workspaceId), eq(inboxContacts.verificationStatus, 'unverified'))).limit(limit)).map(item => ({ id: item.id, value: current.connectorKey === 'email-verification' ? item.email || '' : item.phone || '' })).filter(item => item.value)
      : undefined
    if (values && !values.length) throw new Error(current.connectorKey === 'email-verification' ? '没有待验证且包含邮箱的联系人。' : '没有待验证且包含电话的联系人。')
    const exportRecords = current.connectorKey === 'crm-sync' && settings.syncDirection !== '仅导入到 Sondara'
      ? (await db.select().from(inboxContacts).where(eq(inboxContacts.workspaceId, current.workspaceId)).limit(limit)).filter(item => item.email).map(item => ({ externalId: item.id, company: item.company, name: item.name, email: item.email || undefined, phone: item.phone || undefined, jobTitle: item.jobTitle, region: item.region }))
      : undefined
    const crmObjects = current.connectorKey === 'crm-sync' && importRecords ? await syncHubspotCrmObjects(current, settings, credentials, limit) : null
    const result = await executeExternalConnector({ connectorKey: current.connectorKey, settings, credentials, query, cursor: input.cursor ?? current.cursor ?? undefined, limit, values, exportRecords })
    const applied = importRecords ? await applyConnectorRecords(current.workspaceId, current.connectorKey, current.name, result.records) : { createdCount: 0, updatedCount: 0, skippedCount: 0 }
    applied.updatedCount += result.exportedCount ?? 0
    if (crmObjects) { applied.updatedCount += crmObjects.imported + crmObjects.exported; applied.skippedCount += crmObjects.skipped }
    const completedAt = Date.now(); const nextRunAt = current.scheduleEnabled ? completedAt + current.scheduleIntervalMinutes * 60_000 : null
    await db.update(externalConnectorRuns).set({ status: 'completed', cursor: result.cursor, fetchedCount: result.records.length, ...applied, completedAt }).where(eq(externalConnectorRuns.id, runId))
    await db.update(externalConnectorConfigurations).set({ status: 'available', lastError: null, lastValidatedAt: completedAt, lastRunAt: completedAt, nextRunAt, cursor: result.cursor, consecutiveFailures: 0, pausedReason: null, updatedAt: completedAt }).where(eq(externalConnectorConfigurations.id, current.id))
    await audit(current, input.actorUserId ?? null, 'external_connector.run_completed', { connectorKey: current.connectorKey, runId, scheduled: Boolean(input.scheduled), fetchedCount: result.records.length, ...applied })
    return { id: runId, status: 'completed' as const, fetchedCount: result.records.length, cursor: result.cursor, ...applied }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '连接器运行失败。'; const completedAt = Date.now(); const failures = current.consecutiveFailures + 1
    const autoPaused = failures >= 5
    const retryMinutes = Math.min(60, 2 ** Math.min(failures, 5))
    await db.update(externalConnectorRuns).set({ status: 'failed', error: message, completedAt }).where(eq(externalConnectorRuns.id, runId))
    await db.update(externalConnectorConfigurations).set({ status: autoPaused ? 'paused' : 'error', lastError: message, lastRunAt: completedAt, consecutiveFailures: failures, scheduleEnabled: autoPaused ? false : current.scheduleEnabled, pausedReason: autoPaused ? '连续失败 5 次，已自动暂停。' : `失败后将在 ${retryMinutes} 分钟后重试。`, nextRunAt: autoPaused ? null : completedAt + retryMinutes * 60_000, updatedAt: completedAt }).where(eq(externalConnectorConfigurations.id, current.id))
    await audit(current, input.actorUserId ?? null, 'external_connector.run_failed', { connectorKey: current.connectorKey, runId, scheduled: Boolean(input.scheduled), failures, autoPaused })
    throw new ExternalConnectorRunError(message, runId)
  }
}
