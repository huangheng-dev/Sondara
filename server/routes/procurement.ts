import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, candidateEvidence, customers, integrationConnections, procurementOpportunities, procurementSubscriptions, radarCandidates, radarTasks, tasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { fetchProcurementOpportunities } from '../procurement/connectors.js'
import { requireAuth, requirePermission } from '../plugins/auth.js'

const provider = z.enum(['ted', 'sam-gov', 'ungm', 'world-bank'])
const subscriptionInput = z.object({
  name: z.string().trim().min(2).max(120),
  provider,
  keywords: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  regions: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  noticeTypes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  enabled: z.boolean().default(true),
})
const subscriptionPatch = subscriptionInput.partial().refine(value => Object.keys(value).length > 0)
const listInput = z.object({
  q: z.string().trim().max(120).optional(), provider: provider.optional(), saved: z.coerce.boolean().optional(),
  sort: z.enum(['relevance_desc', 'relevance_asc', 'deadline_asc', 'deadline_desc', 'published_desc', 'published_asc', 'buyer_asc', 'buyer_desc', 'title_asc', 'title_desc']).default('relevance_desc'),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
const parseArray = (value: string) => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed as string[] : [] } catch { return [] } }
const parseObject = (value: string) => { try { return JSON.parse(value) as Record<string, unknown> } catch { return {} } }
const viewSubscription = (row: typeof procurementSubscriptions.$inferSelect) => ({ ...row, keywords: parseArray(row.keywordsJson), regions: parseArray(row.regionsJson), noticeTypes: parseArray(row.noticeTypesJson), keywordsJson: undefined, regionsJson: undefined, noticeTypesJson: undefined })
const viewOpportunity = (row: typeof procurementOpportunities.$inferSelect) => ({ ...row, contact: parseObject(row.contactJson), metadata: parseObject(row.metadataJson), contactJson: undefined, metadataJson: undefined })
const audit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'procurement', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })

export const procurementRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/providers', async request => {
    const connections = await db.select({ provider: integrationConnections.provider, status: integrationConnections.status, hasSecret: sql<boolean>`${integrationConnections.secretCiphertext} is not null` }).from(integrationConnections).where(and(eq(integrationConnections.workspaceId, request.auth.workspaceId), eq(integrationConnections.category, 'procurement'), eq(integrationConnections.enabled, true)))
    const status = new Map(connections.map(item => [item.provider, item]))
    return { items: [
      { provider: 'sam-gov', name: '美国 SAM.gov', mode: 'official_api', configured: Boolean(status.get('sam-gov')?.hasSecret), status: status.get('sam-gov')?.status ?? 'not_configured', sourceUrl: 'https://sam.gov/opportunities', note: '美国联邦预告、招标、授标与单一来源公告；同步 API 需要 Public API Key' },
      { provider: 'ungm', name: '联合国 UNGM', mode: 'official_api', configured: Boolean(status.get('ungm')?.hasSecret), status: status.get('ungm')?.status ?? 'not_configured', sourceUrl: 'https://www.ungm.org/Public/Notice', note: '联合国机构 EOI、RFP、RFQ、ITB 等采购机会；同步接口需要 OAuth 访问令牌' },
      { provider: 'ted', name: '欧盟 TED', mode: 'official_api', configured: true, sourceUrl: 'https://ted.europa.eu/en/', note: '欧盟、欧洲经济区及相关国际公共采购公告；官方 Search API，无需密钥' },
      { provider: 'world-bank', name: 'World Bank Procurement', mode: 'official_api', configured: true, sourceUrl: 'https://projects.worldbank.org/en/projects-operations/procurement', note: '世界银行发展项目采购公告与当前机会；官方公开 JSON API，无需密钥' },
    ] }
  })

  app.get('/subscriptions', async request => ({ items: (await db.select().from(procurementSubscriptions).where(eq(procurementSubscriptions.workspaceId, request.auth.workspaceId)).orderBy(desc(procurementSubscriptions.updatedAt))).map(viewSubscription) }))

  app.post('/subscriptions', async (request, reply) => {
    const parsed = subscriptionInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const record = { id: createId('prs'), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId, name: parsed.data.name, provider: parsed.data.provider, keywordsJson: JSON.stringify(parsed.data.keywords), regionsJson: JSON.stringify(parsed.data.regions), noticeTypesJson: JSON.stringify(parsed.data.noticeTypes), enabled: parsed.data.enabled, lastSyncAt: null, lastSyncStatus: 'never', lastError: null, createdAt: now, updatedAt: now }
    try { await db.insert(procurementSubscriptions).values(record) } catch { return reply.code(409).send({ error: 'SUBSCRIPTION_EXISTS', message: '已存在同名采购订阅。' }) }
    await audit(request.auth.workspaceId, request.auth.userId, 'procurement.subscription_created', record.id, { provider: record.provider })
    return reply.code(201).send(viewSubscription(record))
  })

  app.patch('/subscriptions/:id', async (request, reply) => {
    const parsed = subscriptionPatch.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const id = (request.params as { id: string }).id
    const existing = await db.$first(db.select().from(procurementSubscriptions).where(and(eq(procurementSubscriptions.id, id), eq(procurementSubscriptions.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '采购订阅不存在。' })
    const { keywords, regions, noticeTypes, ...fields } = parsed.data
    await db.update(procurementSubscriptions).set({ ...fields, ...(keywords ? { keywordsJson: JSON.stringify(keywords) } : {}), ...(regions ? { regionsJson: JSON.stringify(regions) } : {}), ...(noticeTypes ? { noticeTypesJson: JSON.stringify(noticeTypes) } : {}), updatedAt: Date.now() }).where(eq(procurementSubscriptions.id, id))
    await audit(request.auth.workspaceId, request.auth.userId, 'procurement.subscription_updated', id, { fields: Object.keys(parsed.data) })
    return viewSubscription((await db.$first(db.select().from(procurementSubscriptions).where(eq(procurementSubscriptions.id, id))))!)
  })

  app.delete('/subscriptions/:id', { preHandler: requirePermission('data.delete') }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = await db.$first(db.select().from(procurementSubscriptions).where(and(eq(procurementSubscriptions.id, id), eq(procurementSubscriptions.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '采购订阅不存在。' })
    await db.delete(procurementSubscriptions).where(eq(procurementSubscriptions.id, id))
    await audit(request.auth.workspaceId, request.auth.userId, 'procurement.subscription_deleted', id)
    return reply.code(204).send()
  })

  app.post('/subscriptions/:id/sync', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const subscription = await db.$first(db.select().from(procurementSubscriptions).where(and(eq(procurementSubscriptions.id, id), eq(procurementSubscriptions.workspaceId, request.auth.workspaceId))))
    if (!subscription) return reply.code(404).send({ error: 'NOT_FOUND', message: '采购订阅不存在。' })
    if (!subscription.enabled) return reply.code(409).send({ error: 'SUBSCRIPTION_DISABLED', message: '请先启用该采购订阅。' })
    const connection = ['ted', 'world-bank'].includes(subscription.provider) ? null : await db.$first(db.select().from(integrationConnections).where(and(eq(integrationConnections.workspaceId, request.auth.workspaceId), eq(integrationConnections.category, 'procurement'), eq(integrationConnections.provider, subscription.provider), eq(integrationConnections.enabled, true)))) ?? null
    const now = Date.now()
    try {
      const items = await fetchProcurementOpportunities(subscription.provider, { keywords: parseArray(subscription.keywordsJson), regions: parseArray(subscription.regionsJson), noticeTypes: parseArray(subscription.noticeTypesJson), limit: 50 }, connection)
      const inputSource = `采购订阅 · ${subscription.id}`
      let linkedTask = await db.$first(db.select().from(radarTasks).where(and(eq(radarTasks.workspaceId, request.auth.workspaceId), eq(radarTasks.inputSource, inputSource))).orderBy(desc(radarTasks.createdAt)))
      if (!linkedTask) {
        const taskId = createId('rdr')
        await db.insert(radarTasks).values({
          id: taskId,
          workspaceId: request.auth.workspaceId,
          name: `采购订阅 · ${subscription.name}`,
          icp: subscription.name,
          mode: '智能多渠道',
          strategy: '采购项目监控',
          dataSourcesJson: JSON.stringify(['procurement']),
          intentSignalsJson: JSON.stringify(['采购公告']),
          depth: '标准研究',
          candidateLimit: 100,
          knowledgeScope: '采购订阅',
          targetRegion: parseArray(subscription.regionsJson).join('、') || '全球',
          researchLanguage: '自动识别',
          inputSource,
          seedUrlsJson: '[]',
          status: 'running',
          progress: 20,
          currentStage: '正在同步官方采购公告',
          ownerUserId: request.auth.userId,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        linkedTask = await db.$first(db.select().from(radarTasks).where(eq(radarTasks.id, taskId)))
      } else {
        await db.update(radarTasks).set({ status: 'running', progress: 20, currentStage: '正在同步官方采购公告', lastError: null, completedAt: null, updatedAt: now }).where(eq(radarTasks.id, linkedTask.id))
      }
      if (!linkedTask) throw new Error('采购订阅对应的获客任务创建失败。')
      let created = 0; let updated = 0
      for (const item of items) {
        const existing = await db.$first(db.select({ id: procurementOpportunities.id }).from(procurementOpportunities).where(and(eq(procurementOpportunities.workspaceId, request.auth.workspaceId), eq(procurementOpportunities.provider, item.provider), eq(procurementOpportunities.externalId, item.externalId))))
        const values = { subscriptionId: subscription.id, title: item.title, buyer: item.buyer, description: item.description, country: item.country, noticeType: item.noticeType, status: item.status, publishedAt: item.publishedAt, deadlineAt: item.deadlineAt, sourceUrl: item.sourceUrl, contactJson: JSON.stringify(item.contact), metadataJson: JSON.stringify(item.metadata), relevanceScore: item.relevanceScore, syncedAt: now, updatedAt: now }
        if (existing) { await db.update(procurementOpportunities).set(values).where(eq(procurementOpportunities.id, existing.id)); updated += 1 }
        else { await db.insert(procurementOpportunities).values({ id: createId('pro'), workspaceId: request.auth.workspaceId, provider: item.provider, externalId: item.externalId, saved: false, dismissedAt: null, createdAt: now, ...values }); created += 1 }

        const candidate = await db.$first(db.select().from(radarCandidates).where(and(eq(radarCandidates.workspaceId, request.auth.workspaceId), eq(radarCandidates.radarTaskId, linkedTask.id), sql`lower(${radarCandidates.company}) = ${item.buyer.trim().toLowerCase()}`)))
        const reason = `官方采购公告“${item.title}”表明该机构存在明确采购需求；仍需核对资格、预算和截止时间。`
        const candidateValues = {
          region: item.country || '待补全',
          industry: item.noticeType || '采购机构',
          score: item.relevanceScore,
          signal: '发布采购公告',
          source: `官方采购公告 · ${item.provider}`,
          confidence: Math.min(100, Math.max(65, item.relevanceScore)),
          reason,
          dimensionsJson: JSON.stringify([{ label: '采购意向', score: item.relevanceScore }, { label: '来源可信度', score: 95 }]),
          committeeJson: JSON.stringify([{ name: String(item.contact.name ?? '待补全'), role: '采购或项目负责人', influence: '待判断', contact: String(item.contact.email ?? item.contact.phone ?? '待验证') }]),
          relationshipsJson: JSON.stringify([{ label: '采购项目', value: item.title }]),
          updatedAt: now,
        }
        let candidateId = candidate?.id
        if (candidate) await db.update(radarCandidates).set(candidateValues).where(eq(radarCandidates.id, candidate.id))
        else {
          candidateId = createId('can')
          await db.insert(radarCandidates).values({ id: candidateId, workspaceId: request.auth.workspaceId, radarTaskId: linkedTask.id, company: item.buyer.trim(), size: '待补全', estimatedValue: 0, currency: 'CNY', status: 'candidate', discoveredAt: now, ...candidateValues })
        }
        const evidenceExists = await db.$first(db.select({ id: candidateEvidence.id }).from(candidateEvidence).where(and(eq(candidateEvidence.candidateId, candidateId!), eq(candidateEvidence.title, item.title), eq(candidateEvidence.sourceUrl, item.sourceUrl))))
        if (!evidenceExists) await db.insert(candidateEvidence).values({ id: createId('evd'), workspaceId: request.auth.workspaceId, candidateId: candidateId!, title: item.title, source: `官方采购公告 · ${item.provider}`, observedLabel: item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('zh-CN') : '同步发现', strength: item.relevanceScore >= 75 ? '强' : '中', sourceUrl: item.sourceUrl, createdAt: now })
      }
      const candidateStats = await db.$first(db.select({ total: sql<number>`count(*)`, highMatch: sql<number>`sum(case when ${radarCandidates.score} >= 90 then 1 else 0 end)` }).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, request.auth.workspaceId), eq(radarCandidates.radarTaskId, linkedTask.id), isNull(radarCandidates.archivedAt))))
      await db.update(radarTasks).set({ status: 'completed', progress: 100, currentStage: '采购公告同步完成', candidatesFound: Number(candidateStats?.total ?? 0), highMatchCount: Number(candidateStats?.highMatch ?? 0), completedAt: now, updatedAt: now }).where(eq(radarTasks.id, linkedTask.id))
      await db.update(procurementSubscriptions).set({ lastSyncAt: now, lastSyncStatus: 'success', lastError: null, updatedAt: now }).where(eq(procurementSubscriptions.id, subscription.id))
      await audit(request.auth.workspaceId, request.auth.userId, 'procurement.subscription_synced', id, { radarTaskId: linkedTask.id, received: items.length, created, updated })
      return { radarTaskId: linkedTask.id, received: items.length, created, updated, syncedAt: now }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message.slice(0, 500) : '采购来源同步失败。'
      const failedTask = await db.$first(db.select({ id: radarTasks.id }).from(radarTasks).where(and(eq(radarTasks.workspaceId, request.auth.workspaceId), eq(radarTasks.inputSource, `采购订阅 · ${subscription.id}`))).orderBy(desc(radarTasks.createdAt)))
      if (failedTask) await db.update(radarTasks).set({ status: 'failed', currentStage: '采购公告同步失败', lastError: message, completedAt: now, updatedAt: now }).where(eq(radarTasks.id, failedTask.id))
      await db.update(procurementSubscriptions).set({ lastSyncAt: now, lastSyncStatus: 'error', lastError: message, updatedAt: now }).where(eq(procurementSubscriptions.id, subscription.id))
      await audit(request.auth.workspaceId, request.auth.userId, 'procurement.subscription_sync_failed', id, { provider: subscription.provider })
      return reply.code(502).send({ error: 'PROCUREMENT_SYNC_FAILED', message })
    }
  })

  app.get('/opportunities', async (request, reply) => {
    const parsed = listInput.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const filters = [eq(procurementOpportunities.workspaceId, request.auth.workspaceId), isNull(procurementOpportunities.dismissedAt)]
    if (parsed.data.provider) filters.push(eq(procurementOpportunities.provider, parsed.data.provider))
    if (parsed.data.saved !== undefined) filters.push(eq(procurementOpportunities.saved, parsed.data.saved))
    if (parsed.data.q) filters.push(or(like(procurementOpportunities.title, `%${parsed.data.q}%`), like(procurementOpportunities.buyer, `%${parsed.data.q}%`), like(procurementOpportunities.description, `%${parsed.data.q}%`))!)
    const where = and(...filters)
    const total = Number((await db.$first(db.select({ n: sql<number>`count(*)` }).from(procurementOpportunities).where(where)))?.n ?? 0)
    const sortOrders = (() => {
      switch (parsed.data.sort) {
        case 'relevance_asc': return [asc(procurementOpportunities.relevanceScore), desc(procurementOpportunities.publishedAt)]
        case 'deadline_asc': return [sql`${procurementOpportunities.deadlineAt} is null`, asc(procurementOpportunities.deadlineAt)]
        case 'deadline_desc': return [sql`${procurementOpportunities.deadlineAt} is null`, desc(procurementOpportunities.deadlineAt)]
        case 'published_asc': return [sql`${procurementOpportunities.publishedAt} is null`, asc(procurementOpportunities.publishedAt)]
        case 'published_desc': return [sql`${procurementOpportunities.publishedAt} is null`, desc(procurementOpportunities.publishedAt)]
        case 'buyer_asc': return [asc(procurementOpportunities.buyer), desc(procurementOpportunities.relevanceScore)]
        case 'buyer_desc': return [desc(procurementOpportunities.buyer), desc(procurementOpportunities.relevanceScore)]
        case 'title_asc': return [asc(procurementOpportunities.title), desc(procurementOpportunities.relevanceScore)]
        case 'title_desc': return [desc(procurementOpportunities.title), desc(procurementOpportunities.relevanceScore)]
        default: return [desc(procurementOpportunities.relevanceScore), desc(procurementOpportunities.publishedAt)]
      }
    })()
    const items = await db.select().from(procurementOpportunities).where(where).orderBy(...sortOrders).limit(parsed.data.pageSize).offset((parsed.data.page - 1) * parsed.data.pageSize)
    return { items: items.map(viewOpportunity), page: parsed.data.page, pageSize: parsed.data.pageSize, total }
  })

  app.post('/opportunities/:id/save', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const item = await db.$first(db.select().from(procurementOpportunities).where(and(eq(procurementOpportunities.id, id), eq(procurementOpportunities.workspaceId, request.auth.workspaceId))))
    if (!item) return reply.code(404).send({ error: 'NOT_FOUND', message: '采购机会不存在。' })
    const now = Date.now()
    await db.update(procurementOpportunities).set({ saved: true, updatedAt: now }).where(eq(procurementOpportunities.id, id))
    const company = item.buyer.trim()
    let customer = await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), sql`lower(${customers.company}) = ${company.toLowerCase()}`)))
    if (!customer) {
      const customerId = createId('cus')
      await db.insert(customers).values({
        id: customerId,
        workspaceId: request.auth.workspaceId,
        company,
        region: item.country || '待补全',
        industry: item.noticeType || '采购机构',
        score: item.relevanceScore,
        confidence: Math.min(100, Math.max(60, item.relevanceScore)),
        signal: '发布采购公告',
        source: `采购机会 · ${item.provider}`,
        stage: '待验证',
        interaction: item.title,
        nextAction: '核对采购资格、关键联系人和参与条件',
        dueAt: item.deadlineAt,
        ownerUserId: request.auth.userId,
        createdAt: now,
        updatedAt: now,
      })
      customer = await db.$first(db.select().from(customers).where(eq(customers.id, customerId)))
    } else {
      await db.update(customers).set({
        region: customer.region === '待补全' && item.country ? item.country : customer.region,
        score: Math.max(customer.score, item.relevanceScore),
        signal: '发布采购公告',
        interaction: item.title,
        nextAction: '核对采购资格、关键联系人和参与条件',
        dueAt: item.deadlineAt ?? customer.dueAt,
        archivedAt: null,
        updatedAt: now,
      }).where(eq(customers.id, customer.id))
    }
    if (!customer) return reply.code(500).send({ error: 'CUSTOMER_CREATE_FAILED', message: '采购方客户档案创建失败。' })
    const existingTask = await db.$first(db.select({ id: tasks.id, customerId: tasks.customerId }).from(tasks).where(and(eq(tasks.workspaceId, request.auth.workspaceId), eq(tasks.source, `采购机会 · ${item.provider}`), eq(tasks.company, item.buyer), eq(tasks.status, 'open'))))
    let taskId = existingTask?.id ?? null
    if (!taskId) {
      taskId = createId('tsk')
      await db.insert(tasks).values({ id: taskId, workspaceId: request.auth.workspaceId, customerId: customer.id, ownerUserId: request.auth.userId, title: `评估采购机会：${item.title}`.slice(0, 200), priority: item.relevanceScore >= 75 ? '高' : '中', dueAt: item.deadlineAt, dueLabel: item.deadlineAt ? '截止前完成' : '7 天内', company: item.buyer, nextAction: '核对资格、截止时间和决策人，决定是否参与', impact: item.sourceUrl, source: `采购机会 · ${item.provider}`, status: 'open', createdAt: now, updatedAt: now })
    } else if (existingTask && !existingTask.customerId) {
      await db.update(tasks).set({ customerId: customer.id, updatedAt: now }).where(eq(tasks.id, existingTask.id))
    }
    await audit(request.auth.workspaceId, request.auth.userId, 'procurement.opportunity_saved', id, { customerId: customer.id, taskId })
    return { ...viewOpportunity({ ...item, saved: true, updatedAt: now }), customerId: customer.id, taskId }
  })

  app.delete('/opportunities/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const item = await db.$first(db.select({ id: procurementOpportunities.id }).from(procurementOpportunities).where(and(eq(procurementOpportunities.id, id), eq(procurementOpportunities.workspaceId, request.auth.workspaceId))))
    if (!item) return reply.code(404).send({ error: 'NOT_FOUND', message: '采购机会不存在。' })
    await db.update(procurementOpportunities).set({ dismissedAt: Date.now(), updatedAt: Date.now() }).where(eq(procurementOpportunities.id, id))
    await audit(request.auth.workspaceId, request.auth.userId, 'procurement.opportunity_dismissed', id)
    return reply.code(204).send()
  })
}
