import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, candidateContacts, candidateEvidence, customers, inboxContacts, radarCandidates, radarJobEvents, radarQueueItems, radarTasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { requireAuth } from '../plugins/auth.js'
import { enrichCandidateContacts } from '../radar/contact-enrichment.js'
import { isChineseDomesticProspect } from '../radar/connectors/prospect-quality.js'
import { hasSearchConfiguration } from '../integrations/search-client.js'
import { hasMapConfiguration } from '../integrations/map-client.js'

const taskStatus = z.enum(['queued', 'running', 'paused', 'completed', 'failed', 'cancelled'])
const candidateStatus = z.enum(['candidate', 'review', 'saved', 'rejected'])

const taskInput = z.object({
  name: z.string().trim().min(1).max(160),
  icp: z.string().trim().min(1).max(240),
  mode: z.string().trim().max(80).default('智能多渠道'),
  depth: z.string().trim().max(80).default('标准研究'),
  candidateLimit: z.number().int().min(1).max(10000).default(100),
  knowledgeScope: z.string().trim().max(120).default('全部资料'),
  targetRegion: z.string().trim().max(120).default('全球'),
  researchLanguage: z.string().trim().max(80).default('自动识别'),
  inputSource: z.string().trim().max(160).default('AI 获客'),
  seedUrls: z.array(z.string().trim().url()).max(100).default([]),
})

const taskListQuery = z.object({
  status: taskStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const taskAction = z.object({ action: z.enum(['pause', 'resume', 'cancel', 'retry']) })

const evidenceInput = z.object({
  title: z.string().trim().min(1).max(240),
  source: z.string().trim().min(1).max(160),
  time: z.string().trim().max(80).default('待确认'),
  strength: z.enum(['强', '中', '弱']).default('中'),
  sourceUrl: z.string().trim().url().nullable().optional(),
})

const dimensionInput = z.object({ label: z.string().trim().min(1).max(80), score: z.number().int().min(0).max(100) })
const committeeInput = z.object({
  name: z.string().trim().min(1).max(120),
  role: z.string().trim().max(120),
  influence: z.string().trim().max(80),
  contact: z.string().trim().max(160),
})
const relationshipInput = z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(240) })

const candidateInput = z.object({
  radarTaskId: z.string().trim().min(1).nullable().optional(),
  company: z.string().trim().min(1).max(160),
  region: z.string().trim().max(80).default('待补全'),
  industry: z.string().trim().max(120).default('待补全'),
  size: z.string().trim().max(80).default('待补全'),
  score: z.number().int().min(0).max(100).default(0),
  signal: z.string().trim().max(160).default('待识别'),
  source: z.string().trim().max(120).default('数据源'),
  estimatedValue: z.number().int().min(0).default(0),
  currency: z.enum(['CNY', 'EUR', 'USD']).default('CNY'),
  confidence: z.number().int().min(0).max(100).default(0),
  status: candidateStatus.default('candidate'),
  reason: z.string().trim().max(1000).default('等待补充研究结论'),
  dimensions: z.array(dimensionInput).max(20).default([]),
  evidence: z.array(evidenceInput).max(100).default([]),
  committee: z.array(committeeInput).max(50).default([]),
  relationships: z.array(relationshipInput).max(50).default([]),
})

const candidatePatch = z.object({ status: candidateStatus })
const candidateListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: candidateStatus.optional(),
  taskId: z.string().trim().min(1).optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'score_desc', 'score_asc', 'company_asc']).default('updated_desc'),
})

const queueListQuery = z.object({
  taskId: z.string().trim().min(1).optional(),
  status: taskStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const safeJson = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T } catch { return fallback }
}

const writeAudit = (workspaceId: string, actorUserId: string, action: string, entityType: string, entityId: string, metadata: unknown = {}) => {
  db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType, entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() }).run()
}

const refreshTaskCounts = (workspaceId: string, radarTaskId: string) => {
  const summary = db.select({
    total: sql<number>`count(*)`,
    highMatch: sql<number>`sum(case when ${radarCandidates.score} >= 90 then 1 else 0 end)`,
  }).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, workspaceId), eq(radarCandidates.radarTaskId, radarTaskId))).get()
  db.update(radarTasks).set({ candidatesFound: summary?.total ?? 0, highMatchCount: summary?.highMatch ?? 0, updatedAt: Date.now() })
    .where(and(eq(radarTasks.id, radarTaskId), eq(radarTasks.workspaceId, workspaceId))).run()
}

export const radarRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/tasks', async (request, reply) => {
    const parsed = taskListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(radarTasks.workspaceId, request.auth.workspaceId)]
    if (query.status) conditions.push(eq(radarTasks.status, query.status))
    const where = and(...conditions)
    const total = db.select({ count: sql<number>`count(*)` }).from(radarTasks).where(where).get()?.count ?? 0
    const items = db.select().from(radarTasks).where(where).orderBy(desc(radarTasks.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize).all().map(item=>({...item,seedUrls:safeJson(item.seedUrlsJson,[])}))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/tasks', async (request, reply) => {
    const parsed = taskInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const hasSeeds = parsed.data.seedUrls.length > 0
    const hasSearch = hasSearchConfiguration(request.auth.workspaceId)
    const hasMap = hasMapConfiguration(request.auth.workspaceId)
    const ready = parsed.data.mode === '智能多渠道' ? hasSeeds || hasSearch || hasMap
      : /企业官网|种子名单/.test(parsed.data.mode) ? hasSeeds
        : /地图找客/.test(parsed.data.mode) ? hasMap
          : /行业名录|展会协会|招投标项目/.test(parsed.data.mode) ? hasSeeds || hasSearch
            : /搜索引擎|招聘扩产|新闻融资|贸易海关|社交网络/.test(parsed.data.mode) ? hasSearch
              : hasSeeds || hasSearch || hasMap
    if (!ready) return reply.code(409).send({
      error: 'DATA_SOURCE_REQUIRED',
      message: /企业官网|种子名单/.test(parsed.data.mode)
        ? '该获客方式必须填写至少一个企业官网或公开来源网址。'
        : /地图找客/.test(parsed.data.mode)
          ? '请先在“数据源集成”配置并测试地图 API。'
          : '请先在“数据源集成”配置并测试搜索 API，或填写可直接研究的公开来源网址。',
    })
    const now = Date.now()
    const { seedUrls, ...taskFields } = parsed.data
    const record = {
      id: createId('rdr'), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId,
      status: 'queued', progress: 0, currentStage: '等待执行', candidatesFound: 0, highMatchCount: 0,
      lastError: null, startedAt: null, completedAt: null, createdAt: now, updatedAt: now, seedUrlsJson:JSON.stringify(seedUrls), ...taskFields,
    }
    const queue = {
      id: createId('job'), workspaceId: request.auth.workspaceId, radarTaskId: record.id, jobType: 'discover',
      status: 'queued', attempts: 0, maxAttempts: 3, scheduledAt: now, startedAt: null, completedAt: null,
      lastError: null, payload: JSON.stringify(parsed.data), createdAt: now, updatedAt: now,
    }
    db.transaction(tx => {
      tx.insert(radarTasks).values(record).run()
      tx.insert(radarQueueItems).values(queue).run()
    })
    writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.task.created', 'radar_task', record.id, { mode: record.mode, inputSource: record.inputSource })
    return reply.code(201).send({ ...record, seedUrls, queueItem: queue })
  })

  app.get('/tasks/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const task = db.select().from(radarTasks).where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId))).get()
    if (!task) return reply.code(404).send({ error: 'NOT_FOUND', message: '雷达任务不存在。' })
    return { ...task, seedUrls: safeJson(task.seedUrlsJson, []) }
  })
  app.patch('/tasks/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = taskAction.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = db.select().from(radarTasks).where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId))).get()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '雷达任务不存在。' })
    const latestQueue = db.select().from(radarQueueItems).where(and(eq(radarQueueItems.radarTaskId, id), eq(radarQueueItems.workspaceId, request.auth.workspaceId))).orderBy(desc(radarQueueItems.createdAt)).get()
    const action = parsed.data.action
    const allowed = action === 'pause' ? ['queued', 'running'].includes(existing.status)
      : action === 'resume' ? existing.status === 'paused'
      : action === 'cancel' ? ['queued', 'running', 'paused', 'failed'].includes(existing.status)
      : existing.status === 'failed'
    if (!allowed) return reply.code(409).send({ error: 'INVALID_TRANSITION', message: `当前状态不能执行“${action}”。` })
    if (action === 'retry' && latestQueue && latestQueue.attempts >= latestQueue.maxAttempts) return reply.code(409).send({ error: 'RETRY_EXHAUSTED', message: '已达到最大重试次数。' })
    const now = Date.now()
    const nextStatus = action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'queued'
    const nextStage = action === 'pause' ? '已暂停' : action === 'cancel' ? '已取消' : '等待执行'
    db.transaction(tx => {
      tx.update(radarTasks).set({ status: nextStatus, currentStage: nextStage, lastError: action === 'retry' ? null : existing.lastError, completedAt: action === 'cancel' ? now : null, updatedAt: now })
        .where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId))).run()
      if (latestQueue) tx.update(radarQueueItems).set({ status: nextStatus, attempts: latestQueue.attempts, lastError: action === 'retry' ? null : latestQueue.lastError, completedAt: action === 'cancel' ? now : null, scheduledAt: action === 'retry' || action === 'resume' ? now : latestQueue.scheduledAt, updatedAt: now })
        .where(and(eq(radarQueueItems.id, latestQueue.id), eq(radarQueueItems.workspaceId, request.auth.workspaceId))).run()
    })
    writeAudit(request.auth.workspaceId, request.auth.userId, `radar.task.${action}`, 'radar_task', id)
    return db.select().from(radarTasks).where(and(eq(radarTasks.id, id), eq(radarTasks.workspaceId, request.auth.workspaceId))).get()
  })

  app.get('/tasks/:id/events', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const task = db.select({ id: radarTasks.id }).from(radarTasks).where(and(eq(radarTasks.id,id),eq(radarTasks.workspaceId,request.auth.workspaceId))).get()
    if(!task)return reply.code(404).send({error:'NOT_FOUND',message:'雷达任务不存在。'})
    const items=db.select().from(radarJobEvents).where(and(eq(radarJobEvents.radarTaskId,id),eq(radarJobEvents.workspaceId,request.auth.workspaceId))).orderBy(desc(radarJobEvents.createdAt)).limit(100).all()
    return {items,total:items.length}
  })

  app.get('/candidates', async (request, reply) => {
    const parsed = candidateListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(radarCandidates.workspaceId, request.auth.workspaceId)]
    if (query.q) conditions.push(or(like(radarCandidates.company, `%${query.q}%`), like(radarCandidates.industry, `%${query.q}%`), like(radarCandidates.signal, `%${query.q}%`))!)
    if (query.status) conditions.push(eq(radarCandidates.status, query.status))
    if (query.taskId) conditions.push(eq(radarCandidates.radarTaskId, query.taskId))
    if (query.minScore !== undefined) conditions.push(gte(radarCandidates.score, query.minScore))
    const where = and(...conditions)
    const orderBy = query.sort === 'score_desc' ? desc(radarCandidates.score)
      : query.sort === 'score_asc' ? asc(radarCandidates.score)
      : query.sort === 'company_asc' ? asc(radarCandidates.company)
      : desc(radarCandidates.updatedAt)
    const total = db.select({ count: sql<number>`count(*)` }).from(radarCandidates).where(where).get()?.count ?? 0
    const rows = db.select().from(radarCandidates).where(where).orderBy(orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize).all()
    const evidenceRows = rows.length ? db.select().from(candidateEvidence).where(and(eq(candidateEvidence.workspaceId, request.auth.workspaceId), inArray(candidateEvidence.candidateId, rows.map(row => row.id)))).orderBy(desc(candidateEvidence.createdAt)).all() : []
    const contactRows = rows.length ? db.select().from(candidateContacts).where(and(eq(candidateContacts.workspaceId, request.auth.workspaceId), inArray(candidateContacts.candidateId, rows.map(row => row.id)))).orderBy(desc(candidateContacts.confidence), desc(candidateContacts.updatedAt)).all() : []
    const items = rows.map(row => ({
      ...row,
      dimensions: safeJson(row.dimensionsJson, []),
      committee: safeJson(row.committeeJson, []),
      relationships: safeJson(row.relationshipsJson, []),
      evidence: evidenceRows.filter(item => item.candidateId === row.id).map(item => ({ id: item.id, title: item.title, source: item.source, time: item.observedLabel, strength: item.strength, sourceUrl: item.sourceUrl })),
      contacts: contactRows.filter(item => item.candidateId === row.id).map(item => ({ id: item.id, name: item.name, role: item.role, email: item.email, phone: item.phone, socialUrl: item.socialUrl, sourceUrl: item.sourceUrl, verificationStatus: item.verificationStatus, confidence: item.confidence })),
    }))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/candidates', async (request, reply) => {
    const parsed = candidateInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    if (parsed.data.radarTaskId) {
      const task = db.select({ id: radarTasks.id }).from(radarTasks).where(and(eq(radarTasks.id, parsed.data.radarTaskId), eq(radarTasks.workspaceId, request.auth.workspaceId))).get()
      if (!task) return reply.code(404).send({ error: 'TASK_NOT_FOUND', message: '关联雷达任务不存在。' })
    }
    const existing = db.select({ id: radarCandidates.id }).from(radarCandidates).where(and(eq(radarCandidates.workspaceId, request.auth.workspaceId), eq(radarCandidates.company, parsed.data.company))).get()
    if (existing) return reply.code(409).send({ error: 'CANDIDATE_EXISTS', message: '该工作区已存在同名候选客户。' })
    const now = Date.now()
    const { dimensions, evidence, committee, relationships, ...fields } = parsed.data
    const record = {
      id: createId('can'), workspaceId: request.auth.workspaceId, discoveredAt: now, updatedAt: now,
      dimensionsJson: JSON.stringify(dimensions), committeeJson: JSON.stringify(committee), relationshipsJson: JSON.stringify(relationships), ...fields,
    }
    db.transaction(tx => {
      tx.insert(radarCandidates).values(record).run()
      if (evidence.length) tx.insert(candidateEvidence).values(evidence.map(item => ({
        id: createId('evd'), workspaceId: request.auth.workspaceId, candidateId: record.id,
        title: item.title, source: item.source, observedLabel: item.time, strength: item.strength,
        sourceUrl: item.sourceUrl ?? null, createdAt: now,
      }))).run()
    })
    if (record.radarTaskId) refreshTaskCounts(request.auth.workspaceId, record.radarTaskId)
    writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.created', 'radar_candidate', record.id, { company: record.company, source: record.source })
    return reply.code(201).send({ ...record, dimensions, committee, relationships, evidence })
  })

  app.patch('/candidates/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = candidatePatch.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = db.select().from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId))).get()
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    db.update(radarCandidates).set({ status: parsed.data.status, updatedAt: Date.now() }).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId))).run()
    writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.updated', 'radar_candidate', id, { status: parsed.data.status })
    return db.select().from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId))).get()
  })

  app.post('/candidates/:id/enrich-contacts', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const candidate = db.select({ id: radarCandidates.id, company: radarCandidates.company }).from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId))).get()
    if (!candidate) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    const result = await enrichCandidateContacts(request.auth.workspaceId, id)
    if (!result) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.contacts_enriched', 'radar_candidate', id, { discovered: result.discovered, pagesScanned: result.pagesScanned })
    return { ...result, message: result.discovered ? `已发现 ${result.discovered} 条新的公开联系方式。` : result.contacts.length ? '未发现新的联系方式，已保留现有结果。' : '未在公开页面中发现可验证的联系方式。' }
  })
  app.post('/candidates/:id/promote', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const candidate = db.select().from(radarCandidates).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId))).get()
    if (!candidate) return reply.code(404).send({ error: 'NOT_FOUND', message: '候选客户不存在。' })
    if (isChineseDomesticProspect({ company: candidate.company, region: candidate.region, industry: candidate.industry, signal: candidate.signal, source: candidate.source, reason: candidate.reason })) return reply.code(409).send({ error: 'DOMESTIC_CHINA_PROSPECT_BLOCKED', message: '外贸获客流程已阻止中国境内公司进入客户库。' })

    // Choose the best reachable contact: verified email first, then any email, then phone-only.
    const contacts = db.select().from(candidateContacts).where(and(eq(candidateContacts.workspaceId, request.auth.workspaceId), eq(candidateContacts.candidateId, id))).orderBy(desc(candidateContacts.confidence), desc(candidateContacts.updatedAt)).all()
    const bestContact = contacts.find(c => c.email && c.verificationStatus === 'verified')
      ?? contacts.find(c => c.email)
      ?? contacts[0]
      ?? null

    const now = Date.now()
    const existingCustomer = db.select().from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), eq(customers.company, candidate.company))).get()
    const validContacts = contacts.filter(c => c.verificationStatus === 'verified').length

    let customer = existingCustomer
    let newCustomer: NonNullable<typeof existingCustomer> | null = null
    let contactCreated = false
    db.transaction((tx) => {
      if (!customer) {
        newCustomer = {
          id: createId('cus'),
          workspaceId: request.auth.workspaceId,
          company: candidate.company,
          region: candidate.region,
          industry: candidate.industry,
          score: candidate.score,
          confidence: candidate.confidence,
          signal: candidate.signal,
          source: candidate.source,
          estimatedValue: candidate.estimatedValue,
          size: candidate.size,
          stage: candidate.score >= 90 ? '重点跟进' : '培育中',
          contacts: contacts.length,
          validContacts,
          interaction: '刚刚 · AI 获客保存',
          nextAction: bestContact?.email ? '安排首次触达' : '补全联系人邮箱',
          ownerUserId: request.auth.userId,
          dueAt: null,
          createdAt: now,
          updatedAt: now,
        }
        customer = newCustomer
        try { tx.insert(customers).values(newCustomer).run() }
        catch { customer = tx.select().from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), eq(customers.company, candidate.company))).get()! }
      } else {
        tx.update(customers).set({ contacts: Math.max(existingCustomer!.contacts, contacts.length), validContacts: Math.max(existingCustomer!.validContacts, validContacts), updatedAt: now }).where(eq(customers.id, existingCustomer!.id)).run()
        customer = tx.select().from(customers).where(eq(customers.id, existingCustomer!.id)).get()
      }

      // Create an inbox contact (with verified email) so campaigns can actually send to this customer.
      if (bestContact?.email) {
        const existingInbox = tx.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.email, bestContact.email))).get()
        if (!existingInbox) {
          tx.insert(inboxContacts).values({
            id: createId('ict'),
            workspaceId: request.auth.workspaceId,
            customerId: customer!.id,
            name: bestContact.name || customer!.company,
            company: customer!.company,
            jobTitle: bestContact.role || '待补全',
            region: customer!.region,
            source: 'AI 获客',
            primaryChannel: '邮件',
            email: bestContact.email,
            phone: bestContact.phone,
            createdAt: now,
            updatedAt: now,
          }).run()
          contactCreated = true
        } else if (!existingInbox.customerId) {
          tx.update(inboxContacts).set({ customerId: customer!.id, updatedAt: now }).where(eq(inboxContacts.id, existingInbox.id)).run()
        }
      }

      tx.update(radarCandidates).set({ status: 'saved', updatedAt: now }).where(and(eq(radarCandidates.id, id), eq(radarCandidates.workspaceId, request.auth.workspaceId))).run()
    })

    writeAudit(request.auth.workspaceId, request.auth.userId, 'radar.candidate.promoted', 'customer', customer!.id, { candidateId: id, company: candidate.company, contactEmail: bestContact?.email ?? null, contactCreated })
    return reply.code(existingCustomer ? 200 : 201).send({ customer, contact: bestContact, contactCreated, reachable: Boolean(bestContact?.email), created: !existingCustomer })
  })

  app.get('/queue', async (request, reply) => {
    const parsed = queueListQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(radarQueueItems.workspaceId, request.auth.workspaceId)]
    if (query.taskId) conditions.push(eq(radarQueueItems.radarTaskId, query.taskId))
    if (query.status) conditions.push(eq(radarQueueItems.status, query.status))
    const where = and(...conditions)
    const total = db.select({ count: sql<number>`count(*)` }).from(radarQueueItems).where(where).get()?.count ?? 0
    const items = db.select().from(radarQueueItems).where(where).orderBy(desc(radarQueueItems.createdAt)).limit(query.pageSize).offset((query.page - 1) * query.pageSize).all()
    return { items, page: query.page, pageSize: query.pageSize, total }
  })
}
