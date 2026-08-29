import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyPluginAsync } from 'fastify'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { auditLogs, customers, inboxContacts, leadSourceConnections, leadSourceEvents, leadSourceOauthStates, tasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { recordCustomerTouchpoint } from '../leads/touchpoints.js'
import { fetchLinkedinLeadResponse, fetchMetaLeadResponse, metaLeadId, ProviderLeadFetchError } from '../leads/provider-enrichment.js'
import { buildLeadSourceAuthorizationUrl, exchangeLeadSourceAuthorizationCode, hashOauthState, oauthRedirectUri, resolveLeadSourceAccessToken } from '../leads/provider-oauth.js'
import { decryptSecret, encryptSecret } from '../lib/secret-vault.js'
import { hashSessionToken } from '../lib/session.js'
import { requireAdmin, requireAuth } from '../plugins/auth.js'

const provider = z.enum(['website-form', 'generic-webhook', 'google-ads-lead-form', 'linkedin-lead-gen', 'meta-lead-ads'])
const connectionInput = z.object({ name: z.string().trim().min(2).max(120), provider, accountRef: z.string().trim().max(200).optional(), formRef: z.string().trim().max(200).optional(), clientId: z.string().trim().max(300).optional(), accessToken: z.string().trim().max(2000).optional(), verificationSecret: z.string().trim().max(2000).optional(), autoCreateCustomer: z.boolean().default(true), createFollowUpTask: z.boolean().default(true), enabled: z.boolean().default(true) })
const patchInput = connectionInput.partial().refine(value => Object.keys(value).length > 0)
const manualLeadInput = z.object({ company: z.string().trim().min(1).max(160), full_name: z.string().trim().max(160).optional(), email: z.string().trim().email().optional().or(z.literal('')), phone: z.string().trim().max(80).optional(), job_title: z.string().trim().max(120).optional(), region: z.string().trim().max(120).optional(), industry: z.string().trim().max(160).optional(), website: z.string().trim().url().optional().or(z.literal('')), message: z.string().trim().max(2000).optional() })
const parseMetadata = (value: string) => { try { return JSON.parse(value) as Record<string, unknown> } catch { return {} } }
const view = (item: typeof leadSourceConnections.$inferSelect) => ({ id: item.id, provider: item.provider, name: item.name, accountRef: item.accountRef, formRef: item.formRef, clientId: item.clientId, autoCreateCustomer: item.autoCreateCustomer, createFollowUpTask: item.createFollowUpTask, enabled: item.enabled, status: item.status, hasAccessToken: Boolean(item.accessTokenCiphertext), accessTokenEnding: item.accessTokenEnding, accessTokenExpiresAt: item.accessTokenExpiresAt, hasRefreshToken: Boolean(item.refreshTokenCiphertext), refreshTokenExpiresAt: item.refreshTokenExpiresAt, oauthScopes: item.oauthScopes, hasVerificationSecret: Boolean(item.verificationSecretCiphertext), verificationSecretEnding: item.verificationSecretEnding, lastError: item.lastError, lastSyncedAt: item.lastSyncedAt, createdAt: item.createdAt, updatedAt: item.updatedAt, webhookPath: `/api/lead-sources/webhook/${item.id}` })
const audit = async (workspaceId: string, actorUserId: string | null, action: string, entityId: string, metadata: Record<string, unknown> = {}) => db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'lead_source', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
const webhookToken = (request: { query: unknown; headers: Record<string, unknown>; body?: unknown }) => {
  const query = request.query as Record<string, unknown>
  const fromQuery = query.token ?? query['hub.verify_token']
  const fromHeader = request.headers['x-sondara-lead-token']
  const googleKey = request.body && typeof request.body === 'object' ? (request.body as Record<string, unknown>).google_key : undefined
  return typeof fromQuery === 'string' ? fromQuery : typeof fromHeader === 'string' ? fromHeader : typeof googleKey === 'string' ? googleKey : ''
}

const verificationSecretFor = (connection: typeof leadSourceConnections.$inferSelect) => connection.verificationSecretCiphertext && connection.verificationSecretIv && connection.verificationSecretTag
  ? decryptSecret({ ciphertext: connection.verificationSecretCiphertext, iv: connection.verificationSecretIv, tag: connection.verificationSecretTag }) : ''
const constantTimeMatch = (actual: string, expected: string) => {
  const left = Buffer.from(actual.toLowerCase()); const right = Buffer.from(expected.toLowerCase())
  return left.length === right.length && timingSafeEqual(left, right)
}
const validateOfficialSignature = (request: { headers: Record<string, unknown>; rawBody?: Buffer }, connection: typeof leadSourceConnections.$inferSelect) => {
  const secret = verificationSecretFor(connection)
  if (!secret || !request.rawBody) return false
  if (connection.provider === 'linkedin-lead-gen') {
    const actual = request.headers['x-li-signature']; if (typeof actual !== 'string') return false
    const expected = createHmac('sha256', secret).update(`hmacsha256=${request.rawBody.toString('utf8')}`).digest('hex')
    return constantTimeMatch(actual, expected)
  }
  if (connection.provider === 'meta-lead-ads') {
    const actual = request.headers['x-hub-signature-256']; if (typeof actual !== 'string' || !actual.startsWith('sha256=')) return false
    const expected = `sha256=${createHmac('sha256', secret).update(request.rawBody).digest('hex')}`
    return constantTimeMatch(actual, expected)
  }
  return true
}

type NormalizedLead = { company: string; name: string; email: string; phone: string; jobTitle: string; region: string; industry: string; website: string; message: string; leadType: string; medium: string; campaign: string; content: string; term: string; referrer: string; landingPage: string }
const normalizedKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '')
const scalar = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
const flattenLeadPayload = (payload: unknown) => {
  const fields = new Map<string, string>()
  const set = (key: unknown, value: unknown) => { const text = scalar(value); if (typeof key === 'string' && text && !fields.has(normalizedKey(key))) fields.set(normalizedKey(key), text) }
  const walk = (value: unknown, depth = 0) => {
    if (depth > 7 || value === null || value === undefined) return
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return }
    if (typeof value !== 'object') return
    const item = value as Record<string, unknown>
    const fieldName = scalar(item.column_id) || scalar(item.column_name) || scalar(item.field_name) || scalar(item.name)
    const fieldValue = scalar(item.string_value) || scalar(item.value) || (Array.isArray(item.values) ? scalar(item.values[0]) : '')
    if (fieldName && fieldValue) set(fieldName, fieldValue)
    for (const [key, nested] of Object.entries(item)) {
      if (typeof nested === 'string' || typeof nested === 'number') set(key, nested)
      else walk(nested, depth + 1)
    }
  }
  walk(payload)
  return fields
}
const firstField = (fields: Map<string, string>, aliases: string[]) => aliases.map(alias => fields.get(normalizedKey(alias))).find(Boolean) ?? ''
const companyFromEmail = (email: string) => {
  const domain = email.split('@')[1]?.toLowerCase() ?? ''
  if (!domain || /^(gmail|outlook|hotmail|yahoo|icloud|qq|163|126|protonmail)\./.test(domain)) return ''
  return domain.replace(/^www\./, '')
}
const normalizeLead = (payload: unknown): NormalizedLead => {
  const fields = flattenLeadPayload(payload)
  const email = firstField(fields, ['email', 'email_address', 'emailaddress', 'work_email', 'business_email'])
  const firstName = firstField(fields, ['first_name', 'firstname', 'given_name'])
  const lastName = firstField(fields, ['last_name', 'lastname', 'family_name'])
  const company = firstField(fields, ['company', 'company_name', 'companyname', 'organization', 'organization_name', 'business', 'business_name']) || companyFromEmail(email)
  return {
    company,
    name: firstField(fields, ['full_name', 'fullname', 'contact_name', 'contactname', 'name']) || [firstName, lastName].filter(Boolean).join(' ') || email.split('@')[0] || '待确认联系人',
    email,
    phone: firstField(fields, ['phone', 'phone_number', 'phonenumber', 'telephone', 'mobile', 'mobile_phone']),
    jobTitle: firstField(fields, ['job_title', 'jobtitle', 'title', 'position', 'role']) || '待补全',
    region: firstField(fields, ['region', 'country', 'city', 'location', 'state']) || '待补全',
    industry: firstField(fields, ['industry', 'sector', 'business_type']) || '待补全',
    website: firstField(fields, ['website', 'company_website', 'url', 'domain']),
    message: firstField(fields, ['message', 'inquiry', 'comments', 'comment', 'description', 'notes', 'request']),
    leadType: firstField(fields, ['event_type', 'eventtype', 'lead_type', 'leadtype', 'conversion_type', 'action']) || 'inquiry',
    medium: firstField(fields, ['utm_medium', 'medium', 'traffic_medium']),
    campaign: firstField(fields, ['utm_campaign', 'campaign', 'campaign_name', 'campaign_id', 'campaignid']),
    content: firstField(fields, ['utm_content', 'content', 'creative', 'creative_id', 'ad_id', 'ad_name']),
    term: firstField(fields, ['utm_term', 'term', 'keyword', 'search_term']),
    referrer: firstField(fields, ['referrer', 'referer', 'referring_url']),
    landingPage: firstField(fields, ['landing_page', 'landingpage', 'page_url', 'form_url']),
  }
}

const processLeadEvent = async (connection: typeof leadSourceConnections.$inferSelect, eventId: string, providerEventId: string, payload: unknown, now: number, force = false) => {
  if (!connection.autoCreateCustomer && !force) {
    await db.update(leadSourceEvents).set({ processingStatus: 'received', processedAt: now }).where(eq(leadSourceEvents.id, eventId))
    return { status: 'received' as const, customerId: null, contactId: null, taskId: null }
  }
  const lead = normalizeLead(payload)
  if (!lead.company) {
    await db.update(leadSourceEvents).set({ processingStatus: 'needs_review', processingError: '缺少企业名称，且无法从企业邮箱识别公司。', processedAt: now }).where(eq(leadSourceEvents.id, eventId))
    return { status: 'needs_review' as const, customerId: null, contactId: null, taskId: null }
  }
  const requestedEventType = normalizedKey(lead.leadType)
  const websiteEventType = /demo|演示/.test(requestedEventType) ? 'demo_request'
    : /trial|试用/.test(requestedEventType) ? 'trial_request'
    : /download|下载|whitepaper|catalog/.test(requestedEventType) ? 'content_download'
    : /chat|客服|聊天/.test(requestedEventType) ? 'chat_inquiry'
    : /phone|call|电话/.test(requestedEventType) ? 'phone_inquiry'
    : 'website_inquiry'
  const eventType = connection.provider === 'website-form' ? websiteEventType : 'lead_submitted'
  const highIntent = eventType !== 'content_download'
  const eventSignal = eventType === 'content_download' ? '下载网站内容资料'
    : eventType === 'demo_request' ? '主动预约演示'
    : eventType === 'trial_request' ? '主动申请试用'
    : eventType === 'chat_inquiry' ? '主动发起在线咨询'
    : eventType === 'phone_inquiry' ? '主动电话咨询'
    : connection.provider === 'website-form' ? '主动提交网站表单'
    : /lead-form|lead-ads|lead-gen/.test(connection.provider) ? '提交广告线索表单' : '外部线索来源提交'
  const source = `${connection.name} · ${connection.provider}`
  const outcome = await db.transaction(async tx => {
    let customer = (await tx.select().from(customers).where(and(eq(customers.workspaceId, connection.workspaceId), sql`lower(${customers.company}) = ${lead.company.toLowerCase()}`)).limit(1))[0]
    if (!customer) {
      const customerId = createId('cus')
      await tx.insert(customers).values({ id: customerId, workspaceId: connection.workspaceId, company: lead.company, region: lead.region, industry: lead.industry, score: connection.provider === 'website-form' ? highIntent ? 88 : 68 : connection.provider === 'generic-webhook' ? 78 : 84, confidence: lead.email || lead.phone ? 86 : 68, signal: eventSignal, source, stage: '待验证', interaction: lead.message || eventSignal, nextAction: highIntent ? '核验联系人并在 24 小时内跟进' : '确认资料兴趣并评估是否进入培育', dueAt: now + (highIntent ? 86_400_000 : 172_800_000), createdAt: now, updatedAt: now })
      customer = (await tx.select().from(customers).where(eq(customers.id, customerId)).limit(1))[0]
    } else {
      await tx.update(customers).set({ signal: eventSignal, interaction: lead.message || eventSignal || customer.interaction, nextAction: highIntent ? '核验联系人并在 24 小时内跟进' : '确认资料兴趣并评估是否进入培育', dueAt: now + (highIntent ? 86_400_000 : 172_800_000), archivedAt: null, updatedAt: now }).where(eq(customers.id, customer.id))
    }
    let contact = lead.email || lead.phone
      ? (await tx.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, connection.workspaceId), or(...[lead.email ? eq(inboxContacts.email, lead.email) : null, lead.phone ? eq(inboxContacts.phone, lead.phone) : null].filter((value): value is NonNullable<typeof value> => value !== null)))).limit(1))[0]
      : (await tx.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, connection.workspaceId), eq(inboxContacts.company, lead.company), eq(inboxContacts.name, lead.name))).limit(1))[0]
    if (!contact) {
      const contactId = createId('ict')
      await tx.insert(inboxContacts).values({ id: contactId, workspaceId: connection.workspaceId, customerId: customer.id, name: lead.name, company: lead.company, jobTitle: lead.jobTitle, region: lead.region, source, primaryChannel: lead.email ? '邮件' : lead.phone ? '电话' : '待确认', email: lead.email || null, phone: lead.phone || null, externalRef: lead.website || providerEventId, verificationStatus: 'unverified', createdAt: now, updatedAt: now })
      contact = (await tx.select().from(inboxContacts).where(eq(inboxContacts.id, contactId)).limit(1))[0]
    } else {
      await tx.update(inboxContacts).set({ customerId: customer.id, company: customer.company, jobTitle: contact.jobTitle === '待补全' ? lead.jobTitle : contact.jobTitle, region: contact.region === '待补全' ? lead.region : contact.region, email: contact.email || lead.email || null, phone: contact.phone || lead.phone || null, externalRef: contact.externalRef || lead.website || providerEventId, updatedAt: now }).where(eq(inboxContacts.id, contact.id))
    }
    const contactCounts = (await tx.select({ total: sql<number>`count(*)`, reachable: sql<number>`sum(case when ${inboxContacts.email} is not null or ${inboxContacts.phone} is not null then 1 else 0 end)` }).from(inboxContacts).where(and(eq(inboxContacts.workspaceId, connection.workspaceId), eq(inboxContacts.customerId, customer.id))))[0]
    await tx.update(customers).set({ contacts: contactCounts?.total ?? 0, validContacts: contactCounts?.reachable ?? 0, updatedAt: now }).where(eq(customers.id, customer.id))
    let task = connection.createFollowUpTask ? (await tx.select().from(tasks).where(and(eq(tasks.workspaceId, connection.workspaceId), eq(tasks.customerId, customer.id), eq(tasks.status, 'open'), eq(tasks.source, source))).limit(1))[0] : null
    if (connection.createFollowUpTask && !task) {
      const taskId = createId('tsk')
      await tx.insert(tasks).values({ id: taskId, workspaceId: connection.workspaceId, customerId: customer.id, title: `跟进新线索：${customer.company}`, priority: highIntent ? '高' : '中', dueAt: now + (highIntent ? 86_400_000 : 172_800_000), dueLabel: highIntent ? '24 小时内' : '48 小时内', company: customer.company, nextAction: highIntent ? '核验需求、联系人和来源后完成首次跟进' : '确认内容兴趣并决定进入销售跟进或自动培育', impact: lead.message || eventSignal, source, status: 'open', createdAt: now, updatedAt: now })
      task = (await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1))[0]
    } else if (task) {
      await tx.update(tasks).set({ dueAt: now + (highIntent ? 86_400_000 : 172_800_000), dueLabel: highIntent ? '24 小时内' : '48 小时内', priority: highIntent ? '高' : task.priority, impact: lead.message || eventSignal || task.impact, updatedAt: now }).where(eq(tasks.id, task.id))
    }
    await tx.update(leadSourceEvents).set({ processingStatus: 'processed', processingError: null, customerId: customer.id, contactId: contact.id, taskId: task?.id ?? null, processedAt: now }).where(eq(leadSourceEvents.id, eventId))
    return { status: 'processed' as const, customerId: customer.id, contactId: contact.id, taskId: task?.id ?? null }
  })
  await recordCustomerTouchpoint({
    workspaceId: connection.workspaceId,
    customerId: outcome.customerId,
    contactId: outcome.contactId,
    eventType,
    source: connection.provider,
    medium: lead.medium || (connection.provider === 'website-form' ? 'website' : 'lead-form'),
    campaign: lead.campaign || connection.formRef || connection.accountRef,
    content: lead.content,
    term: lead.term,
    referrer: lead.referrer,
    landingPage: lead.landingPage,
    externalId: providerEventId,
    metadata: { connectionId: connection.id, connectionName: connection.name },
    occurredAt: now,
  })
  return outcome
}

export const leadSourceRoutes: FastifyPluginAsync = async app => {
  app.get('/connections', { preHandler: requireAuth }, async request => ({ items: (await db.select().from(leadSourceConnections).where(eq(leadSourceConnections.workspaceId, request.auth.workspaceId)).orderBy(desc(leadSourceConnections.createdAt))).map(view) }))

  app.post('/connections', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = connectionInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now(); const id = createId('lsc'); const token = randomBytes(32).toString('base64url'); const encrypted = parsed.data.accessToken ? encryptSecret(parsed.data.accessToken) : null; const verification = parsed.data.verificationSecret ? encryptSecret(parsed.data.verificationSecret) : null
    const officialConfigured = parsed.data.provider === 'google-ads-lead-form' || (['linkedin-lead-gen', 'meta-lead-ads'].includes(parsed.data.provider) && Boolean(parsed.data.accessToken && parsed.data.verificationSecret))
    const record = { id, workspaceId: request.auth.workspaceId, provider: parsed.data.provider, name: parsed.data.name, accountRef: parsed.data.accountRef ?? null, formRef: parsed.data.formRef ?? null, clientId: parsed.data.clientId ?? null, accessTokenCiphertext: encrypted?.ciphertext ?? null, accessTokenIv: encrypted?.iv ?? null, accessTokenTag: encrypted?.tag ?? null, accessTokenEnding: parsed.data.accessToken?.slice(-4).toUpperCase() ?? null, accessTokenExpiresAt: null, refreshTokenCiphertext: null, refreshTokenIv: null, refreshTokenTag: null, refreshTokenEnding: null, refreshTokenExpiresAt: null, oauthScopes: null, verificationSecretCiphertext: verification?.ciphertext ?? null, verificationSecretIv: verification?.iv ?? null, verificationSecretTag: verification?.tag ?? null, verificationSecretEnding: parsed.data.verificationSecret?.slice(-4).toUpperCase() ?? null, webhookTokenHash: hashSessionToken(token), autoCreateCustomer: parsed.data.autoCreateCustomer, createFollowUpTask: parsed.data.createFollowUpTask, enabled: parsed.data.enabled, status: ['website-form', 'generic-webhook'].includes(parsed.data.provider) || officialConfigured ? 'ready' : 'not_configured', lastError: null, lastSyncedAt: null, createdAt: now, updatedAt: now }
    try { await db.insert(leadSourceConnections).values(record) } catch { return reply.code(409).send({ error: 'CONNECTION_EXISTS', message: '已存在同名线索来源连接。' }) }
    await audit(request.auth.workspaceId, request.auth.userId, 'lead_source.created', id, { provider: record.provider })
    return reply.code(201).send({ ...view(record), webhookUrl: `${config.webOrigin.replace(/\/$/, '')}/api/lead-sources/webhook/${id}?token=${encodeURIComponent(token)}`, webhookToken: token })
  })

  app.patch('/connections/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = patchInput.safeParse(request.body); const id = (request.params as { id: string }).id
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '线索来源连接不存在。' })
    const { accessToken, verificationSecret, ...fields } = parsed.data; const encrypted = accessToken ? encryptSecret(accessToken) : null; const verification = verificationSecret ? encryptSecret(verificationSecret) : null
    await db.update(leadSourceConnections).set({ ...fields, ...(encrypted ? { accessTokenCiphertext: encrypted.ciphertext, accessTokenIv: encrypted.iv, accessTokenTag: encrypted.tag, accessTokenEnding: accessToken!.slice(-4).toUpperCase(), lastError: null } : {}), ...(verification ? { verificationSecretCiphertext: verification.ciphertext, verificationSecretIv: verification.iv, verificationSecretTag: verification.tag, verificationSecretEnding: verificationSecret!.slice(-4).toUpperCase(), lastError: null } : {}), status: encrypted || verification ? 'ready_for_verification' : existing.status, updatedAt: Date.now() }).where(eq(leadSourceConnections.id, id))
    await audit(request.auth.workspaceId, request.auth.userId, 'lead_source.updated', id, { fields: Object.keys(parsed.data).filter(key => !['accessToken', 'verificationSecret'].includes(key)) })
    return view((await db.$first(db.select().from(leadSourceConnections).where(eq(leadSourceConnections.id, id))))!)
  })

  app.delete('/connections/:id', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const connection = await db.$first(db.select({ id: leadSourceConnections.id, name: leadSourceConnections.name }).from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.workspaceId, request.auth.workspaceId))))
    if (!connection) return reply.code(404).send({ error: 'NOT_FOUND', message: '线索来源连接不存在。' })
    const eventCount = await db.$first(db.select({ count: sql<number>`count(*)` }).from(leadSourceEvents).where(and(eq(leadSourceEvents.connectionId, id), eq(leadSourceEvents.workspaceId, request.auth.workspaceId))))
    if ((eventCount?.count ?? 0) > 0) return reply.code(409).send({ error: 'CONNECTION_HAS_EVENTS', message: '该连接已有线索接入记录，请停用连接以保留来源与归因历史。' })
    await db.delete(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.workspaceId, request.auth.workspaceId)))
    await audit(request.auth.workspaceId, request.auth.userId, 'lead_source.deleted', id, { name: connection.name })
    return reply.code(204).send()
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

  app.post('/connections/:id/oauth/start', { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.workspaceId, request.auth.workspaceId))))
    if (!connection) return reply.code(404).send({ error: 'NOT_FOUND', message: '线索来源连接不存在。' })
    if (!['linkedin-lead-gen', 'meta-lead-ads'].includes(connection.provider)) return reply.code(409).send({ error: 'OAUTH_NOT_SUPPORTED', message: '当前线索来源不需要 OAuth 授权。' })
    if (!connection.clientId || !verificationSecretFor(connection)) return reply.code(409).send({ error: 'OAUTH_CONFIGURATION_REQUIRED', message: '请先保存平台 Client / App ID 和 Secret。' })
    const state = randomBytes(32).toString('base64url')
    const redirectUri = oauthRedirectUri(connection.provider)
    const now = Date.now()
    await db.insert(leadSourceOauthStates).values({ id: createId('los'), stateHash: hashOauthState(state), workspaceId: connection.workspaceId, connectionId: connection.id, actorUserId: request.auth.userId, provider: connection.provider, redirectUri, expiresAt: now + 10 * 60_000, usedAt: null, createdAt: now })
    const authorizationUrl = buildLeadSourceAuthorizationUrl({ connection, state, redirectUri })
    await audit(connection.workspaceId, request.auth.userId, 'lead_source.oauth_started', connection.id, { provider: connection.provider })
    return { authorizationUrl, redirectUri, expiresAt: now + 10 * 60_000 }
  })

  app.get('/oauth/:provider/callback', async (request, reply) => {
    const routeProvider = (request.params as { provider: string }).provider
    const query = request.query as Record<string, unknown>
    const state = typeof query.state === 'string' ? query.state : ''
    const code = typeof query.code === 'string' ? query.code : ''
    const errorDescription = typeof query.error_description === 'string' ? query.error_description : typeof query.error === 'string' ? query.error : ''
    const target = new URL('/settings/lead-sources', config.webOrigin)
    const oauthState = state ? await db.$first(db.select().from(leadSourceOauthStates).where(and(eq(leadSourceOauthStates.stateHash, hashOauthState(state)), eq(leadSourceOauthStates.provider, routeProvider), isNull(leadSourceOauthStates.usedAt)))) : null
    if (!oauthState || oauthState.expiresAt <= Date.now()) {
      target.searchParams.set('oauth', 'invalid_state')
      return reply.redirect(target.toString())
    }
    await db.update(leadSourceOauthStates).set({ usedAt: Date.now() }).where(eq(leadSourceOauthStates.id, oauthState.id))
    const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, oauthState.connectionId), eq(leadSourceConnections.workspaceId, oauthState.workspaceId))))
    if (!connection || errorDescription || !code) {
      const message = errorDescription || '平台未返回授权码。'
      if (connection) await db.update(leadSourceConnections).set({ status: 'authorization_failed', lastError: message, updatedAt: Date.now() }).where(eq(leadSourceConnections.id, connection.id))
      target.searchParams.set('oauth', 'failed')
      target.searchParams.set('message', message.slice(0, 200))
      return reply.redirect(target.toString())
    }
    try {
      await exchangeLeadSourceAuthorizationCode({ connection, code, redirectUri: oauthState.redirectUri })
      await audit(connection.workspaceId, oauthState.actorUserId, 'lead_source.oauth_completed', connection.id, { provider: connection.provider })
      target.searchParams.set('oauth', 'success')
      target.searchParams.set('connection', connection.id)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '平台授权失败。'
      await db.update(leadSourceConnections).set({ status: 'authorization_failed', lastError: message, updatedAt: Date.now() }).where(eq(leadSourceConnections.id, connection.id))
      target.searchParams.set('oauth', 'failed')
      target.searchParams.set('message', message.slice(0, 200))
    }
    return reply.redirect(target.toString())
  })

  app.get('/events', { preHandler: requireAdmin }, async request => ({ items: (await db.select().from(leadSourceEvents).where(eq(leadSourceEvents.workspaceId, request.auth.workspaceId)).orderBy(desc(leadSourceEvents.receivedAt)).limit(200)).map(item => ({ ...item, payload: parseMetadata(item.payloadJson) })) }))

  app.post('/events/:id/process', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = manualLeadInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const id = (request.params as { id: string }).id
    const event = await db.$first(db.select().from(leadSourceEvents).where(and(eq(leadSourceEvents.id, id), eq(leadSourceEvents.workspaceId, request.auth.workspaceId))))
    if (!event) return reply.code(404).send({ error: 'NOT_FOUND', message: '线索事件不存在。' })
    if (event.processingStatus === 'processed') return reply.code(409).send({ error: 'ALREADY_PROCESSED', message: '该事件已经完成入库。' })
    const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, event.connectionId), eq(leadSourceConnections.workspaceId, request.auth.workspaceId))))
    if (!connection) return reply.code(404).send({ error: 'CONNECTION_NOT_FOUND', message: '线索来源连接不存在。' })
    const original = parseMetadata(event.payloadJson)
    const outcome = await processLeadEvent(connection, event.id, event.providerEventId, { ...original, ...parsed.data }, Date.now(), true)
    await db.update(leadSourceConnections).set({ status: 'active', lastError: null, updatedAt: Date.now() }).where(eq(leadSourceConnections.id, connection.id))
    await audit(request.auth.workspaceId, request.auth.userId, 'lead_source.event_manually_processed', connection.id, { eventId: event.id, ...outcome })
    return outcome
  })

  app.get('/webhook/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id; const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.enabled, true))))
    if (!connection || !webhookToken(request) || hashSessionToken(webhookToken(request)) !== connection.webhookTokenHash) return reply.code(403).send({ error: 'INVALID_WEBHOOK_TOKEN', message: 'Webhook 验证失败。' })
    const query = request.query as Record<string, unknown>; const challenge = query['hub.challenge']
    const linkedinChallenge = query.challengeCode
    if (connection.provider === 'linkedin-lead-gen' && typeof linkedinChallenge === 'string') {
      const secret = verificationSecretFor(connection)
      if (!secret) return reply.code(409).send({ error: 'VERIFICATION_SECRET_REQUIRED', message: '请先配置 LinkedIn Client Secret。' })
      return { challengeCode: linkedinChallenge, challengeResponse: createHmac('sha256', secret).update(linkedinChallenge).digest('hex') }
    }
    if (typeof challenge === 'string') return reply.type('text/plain').send(challenge)
    return { ok: true, provider: connection.provider }
  })

  app.post('/webhook/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id; const connection = await db.$first(db.select().from(leadSourceConnections).where(and(eq(leadSourceConnections.id, id), eq(leadSourceConnections.enabled, true))))
    if (!connection || !webhookToken(request) || hashSessionToken(webhookToken(request)) !== connection.webhookTokenHash) return reply.code(403).send({ error: 'INVALID_WEBHOOK_TOKEN', message: 'Webhook 验证失败。' })
    const requiresSignature = ['linkedin-lead-gen', 'meta-lead-ads'].includes(connection.provider) && Boolean(verificationSecretFor(connection))
    if (requiresSignature && !validateOfficialSignature(request as typeof request & { rawBody?: Buffer }, connection)) return reply.code(403).send({ error: 'INVALID_PROVIDER_SIGNATURE', message: '官方平台签名验证失败。' })
    const payload = request.body ?? {}; const data = payload as Record<string, unknown>; const metaId = metaLeadId(payload); const eventId = typeof data.lead_id === 'string' ? data.lead_id : metaId || (typeof data.leadGenFormResponse === 'string' && (typeof data.occurredAt === 'string' || typeof data.occurredAt === 'number') ? `${data.leadGenFormResponse}:${data.occurredAt}` : typeof data.id === 'string' ? data.id : createHash('sha256').update(JSON.stringify(payload)).digest('hex'))
    const now = Date.now()
    const leadEventId = createId('lse')
    try { await db.insert(leadSourceEvents).values({ id: leadEventId, workspaceId: connection.workspaceId, connectionId: connection.id, providerEventId: eventId.slice(0, 200), payloadJson: JSON.stringify(payload), processingStatus: 'received', processingError: null, customerId: null, contactId: null, taskId: null, receivedAt: now, processedAt: null }) }
    catch { return { ok: true, duplicate: true } }
    try {
      let processingPayload = payload
      if (connection.provider === 'linkedin-lead-gen') {
        try {
          processingPayload = await fetchLinkedinLeadResponse({ notification: payload, accessToken: await resolveLeadSourceAccessToken(connection), apiVersion: config.linkedinApiVersion })
          await db.update(leadSourceEvents).set({ payloadJson: JSON.stringify(processingPayload) }).where(eq(leadSourceEvents.id, leadEventId))
        } catch (cause) {
          const message = cause instanceof ProviderLeadFetchError ? cause.message : 'LinkedIn 线索详情读取失败。'
          await db.update(leadSourceEvents).set({ processingStatus: 'needs_review', processingError: message, processedAt: now }).where(eq(leadSourceEvents.id, leadEventId))
          await db.update(leadSourceConnections).set({ status: 'webhook_received', lastError: `${message} 已保留可信通知，可人工补全。`, lastSyncedAt: now, updatedAt: now }).where(eq(leadSourceConnections.id, connection.id))
          await audit(connection.workspaceId, null, 'lead_source.event_needs_review', connection.id, { provider: connection.provider, eventId: eventId.slice(0, 100), reason: message })
          return { ok: true, accepted: true, status: 'needs_review', customerId: null, contactId: null, taskId: null }
        }
      }
      if (connection.provider === 'meta-lead-ads') {
        try {
          processingPayload = await fetchMetaLeadResponse({ notification: payload, accessToken: await resolveLeadSourceAccessToken(connection), graphApiVersion: config.metaGraphApiVersion })
          await db.update(leadSourceEvents).set({ payloadJson: JSON.stringify(processingPayload) }).where(eq(leadSourceEvents.id, leadEventId))
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : 'Meta 线索详情读取失败。'
          await db.update(leadSourceEvents).set({ processingStatus: 'needs_review', processingError: message, processedAt: now }).where(eq(leadSourceEvents.id, leadEventId))
          await db.update(leadSourceConnections).set({ status: 'webhook_received', lastError: `${message} 已保留可信通知，可人工补全。`, lastSyncedAt: now, updatedAt: now }).where(eq(leadSourceConnections.id, connection.id))
          await audit(connection.workspaceId, null, 'lead_source.event_needs_review', connection.id, { provider: connection.provider, eventId: eventId.slice(0, 100), reason: message })
          return { ok: true, accepted: true, status: 'needs_review', customerId: null, contactId: null, taskId: null }
        }
      }
      const outcome = await processLeadEvent(connection, leadEventId, eventId.slice(0, 200), processingPayload, now)
      await db.update(leadSourceConnections).set({ status: outcome.status === 'processed' ? 'active' : 'webhook_received', lastError: outcome.status === 'needs_review' ? '最近事件缺少企业信息，等待人工处理。' : null, lastSyncedAt: now, updatedAt: now }).where(eq(leadSourceConnections.id, connection.id))
      await audit(connection.workspaceId, null, 'lead_source.event_processed', connection.id, { provider: connection.provider, eventId: eventId.slice(0, 100), ...outcome })
      return { ok: true, accepted: true, ...outcome }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '线索处理失败'
      await db.update(leadSourceEvents).set({ processingStatus: 'failed', processingError: message, processedAt: Date.now() }).where(eq(leadSourceEvents.id, leadEventId))
      await db.update(leadSourceConnections).set({ status: 'error', lastError: message, lastSyncedAt: now, updatedAt: Date.now() }).where(eq(leadSourceConnections.id, connection.id))
      return reply.code(202).send({ ok: true, accepted: true, status: 'failed', message: '事件已保存，但自动入库失败，请在管理中心处理。' })
    }
  })
}
