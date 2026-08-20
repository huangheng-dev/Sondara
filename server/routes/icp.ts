import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { AiUnavailableError, completeWithAi, hasAiConfiguration } from '../ai/client.js'
import { db } from '../db/client.js'
import { auditLogs, businessProfiles, knowledgeItems } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { pickProvided } from '../lib/input.js'
import { requireAuth } from '../plugins/auth.js'

const knowledgeTypes = ['产品与方案', '产品知识', '应用知识', '合规知识', '公司资料', '客户案例', '客户判断规则', '市场知识', '竞争信息'] as const
const knowledgeStatuses = ['已启用', '待复核', '已停用'] as const

const profileInput = z.object({
  company: z.string().trim().max(200).default(''),
  website: z.string().trim().max(300).default(''),
  products: z.string().trim().max(4000).default(''),
  regions: z.string().trim().max(1000).default(''),
  customers: z.string().trim().max(4000).default(''),
  exclusions: z.string().trim().max(2000).default(''),
  selectedMarket: z.string().trim().max(200).optional(),
})

const knowledgeInput = z.object({
  title: z.string().trim().min(1).max(200),
  itemType: z.enum(knowledgeTypes).default('市场知识'),
  summary: z.string().max(8000).default(''),
  source: z.string().trim().max(300).default('手动录入'),
  sourceUrl: z.string().trim().max(500).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  status: z.enum(knowledgeStatuses).default('待复核'),
})
const knowledgePatch = knowledgeInput.partial()

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  itemType: z.enum(knowledgeTypes).optional(),
  status: z.enum(knowledgeStatuses).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'updated_asc', 'title_asc', 'title_desc', 'references_desc', 'references_asc']).default('updated_desc'),
})

type ProfileRow = typeof businessProfiles.$inferSelect
type KnowledgeRow = typeof knowledgeItems.$inferSelect

const serializeProfile = (row: ProfileRow) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  company: row.company,
  website: row.website,
  products: row.products,
  regions: row.regions,
  customers: row.customers,
  exclusions: row.exclusions,
  selectedMarket: row.selectedMarket,
  analysisStatus: row.analysisStatus,
  analysisSummary: row.analysisSummary,
  analysisMode: row.analysisMode,
  analysisError: row.analysisError,
  analyzedAt: row.analyzedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const serializeKnowledge = (row: KnowledgeRow) => ({
  id: row.id,
  workspaceId: row.workspaceId,
  title: row.title,
  itemType: row.itemType,
  summary: row.summary,
  source: row.source,
  sourceUrl: row.sourceUrl,
  tags: (() => { try { return JSON.parse(row.tagsJson) as string[] } catch { return [] } })(),
  status: row.status,
  referenceCount: row.referenceCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({
        id: createId('aud'), workspaceId, actorUserId, action,
        entityType: 'business_profile', entityId,
        metadata: JSON.stringify(metadata), createdAt: Date.now(),
      })
}

const writeKnowledgeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({
        id: createId('aud'), workspaceId, actorUserId, action,
        entityType: 'knowledge_item', entityId,
        metadata: JSON.stringify(metadata), createdAt: Date.now(),
      })
}

const ensureProfile = async (workspaceId: string, userId: string): Promise<ProfileRow> => {
  const existing = (await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.workspaceId, workspaceId))))
  if (existing) return existing
  const now = Date.now()
  const row: ProfileRow = {
    id: createId('bpr'), workspaceId, ownerUserId: userId,
    company: '', website: '', products: '', regions: '', customers: '', exclusions: '',
    selectedMarket: '德国食品设备',
    analysisStatus: 'idle', analysisSummary: '', analysisMode: 'idle', analysisError: null,
    analyzedAt: null, createdAt: now, updatedAt: now,
  }
  await db.insert(businessProfiles).values(row)
  return row
}

type AnalysisResult = {
  summary: string
  signals: string[]
  recommendedMarkets: { name: string; reason: string }[]
  criteria: string[]
}

const localAnalyze = (input: z.infer<typeof profileInput>): AnalysisResult => {
  const products = (input.products || '').trim()
  const customers = (input.customers || '').trim()
  const regions = (input.regions || '').trim()
  const summaryBits: string[] = []
  if (products) summaryBits.push(`根据“${products.slice(0, 40)}${products.length > 40 ? '…' : ''}”的产品能力`)
  if (customers) summaryBits.push(`已成交/理想客户为“${customers.slice(0, 40)}${customers.length > 40 ? '…' : ''}”`)
  if (regions) summaryBits.push(`主要销售地区覆盖 ${regions}`)
  const summary = summaryBits.length
    ? `${summaryBits.join('，')}。建议优先围绕已有产品验证和明确客户画像的细分市场展开 AI 获客，并保留证据和人工复核。`
    : '业务资料尚不完善。建议先补充产品、客户示例和重点地区，AI 获客才能据此生成更可靠的市场和候选判断。'
  const signals = ['扩产或新建项目', '技术升级或自动化改造', '相关岗位招聘', '招投标、融资或并购公告']
  const recommendedMarkets: { name: string; reason: string }[] = []
  if (/食品|乳品|饮料|餐饮|烘焙/i.test(products + customers))
    recommendedMarkets.push({ name: '德国食品设备', reason: '食品工厂对卫生级设备与自动化改造需求稳定，且公开信号较易核实。' })
  if (/制药|医药|GMP|生物/i.test(products + customers))
    recommendedMarkets.push({ name: '华东制药装备', reason: 'GMP 扩产与新建产线带来设备采购窗口，客户预算和决策链相对明确。' })
  if (/阀门|泵|管路|流体|管道/i.test(products))
    recommendedMarkets.push({ name: '北美阀门经销', reason: '区域经销商持续补充品牌，适合通过行业名录与展会渠道识别。' })
  if (!recommendedMarkets.length)
    recommendedMarkets.push({ name: '待验证细分市场', reason: '请补充产品与客户示例后再运行分析，以获得更明确的市场建议。' })
  const criteria = [
    customers ? `优先匹配客户画像：${customers.slice(0, 60)}` : '优先行业与产品应用场景匹配的企业',
    '200 人以上或具备自有工厂、工程团队/区域渠道能力',
    '出现扩产、技术升级、招聘或招投标等近期公开信号',
  ]
  return { summary, signals, recommendedMarkets, criteria }
}

export const icpRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/profile', async (request) => {
    const row = (await ensureProfile(request.auth.workspaceId, request.auth.userId))
    return serializeProfile(row)
  })

  app.put('/profile', async (request, reply) => {
    const parsed = profileInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await ensureProfile(request.auth.workspaceId, request.auth.userId))
    const now = Date.now()
    await db.update(businessProfiles).set({
            ...pickProvided(request.body, parsed.data),
            updatedAt: now,
          }).where(and(eq(businessProfiles.id, existing.id), eq(businessProfiles.workspaceId, request.auth.workspaceId)))
    const updated = (await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.id, existing.id))))!
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'icp.profile.updated', existing.id, { fields: Object.keys(parsed.data) })
    return serializeProfile(updated)
  })

  app.post('/profile/analyze', async (request, reply) => {
    const existing = (await ensureProfile(request.auth.workspaceId, request.auth.userId))
    const now = Date.now()
    await db.update(businessProfiles).set({ analysisStatus: 'running', analysisError: null, updatedAt: now })
            .where(eq(businessProfiles.id, existing.id))
    const input: z.infer<typeof profileInput> = {
      company: existing.company, website: existing.website, products: existing.products,
      regions: existing.regions, customers: existing.customers, exclusions: existing.exclusions,
      selectedMarket: existing.selectedMarket,
    }
    let result: AnalysisResult
    let mode: 'ai' | 'local-rules' = 'local-rules'
    let error: string | null = null
    if ((await hasAiConfiguration(request.auth.workspaceId))) {
      try {
        const response = await completeWithAi({
          workspaceId: request.auth.workspaceId,
          messages: [
            { role: 'system', content: '你是 B2B 客户定位分析师。只能根据用户提供的业务资料归纳，不得虚构数据或客户。只输出 JSON，字段为 summary(string)、signals(string[])、recommendedMarkets({name,reason}[])、criteria(string[])。' },
            { role: 'user', content: `公司：${input.company}\n官网：${input.website}\n产品：${input.products}\n地区：${input.regions}\n客户示例：${input.customers}\n排除：${input.exclusions}` },
          ], maxTokens: 900, temperature: .2,
        })
        const parsed = JSON.parse(response.content) as Partial<AnalysisResult>
        result = {
          summary: typeof parsed.summary === 'string' ? parsed.summary : '',
          signals: Array.isArray(parsed.signals) ? parsed.signals.slice(0, 6).map(x => String(x)) : [],
          recommendedMarkets: Array.isArray(parsed.recommendedMarkets)
            ? parsed.recommendedMarkets.slice(0, 4).map(x => ({ name: String(x?.name ?? ''), reason: String(x?.reason ?? '') })).filter(x => x.name)
            : [],
          criteria: Array.isArray(parsed.criteria) ? parsed.criteria.slice(0, 6).map(x => String(x)) : [],
        }
        if (!result.summary || !result.recommendedMarkets.length) throw new Error('AI_RESULT_INCOMPLETE')
        mode = 'ai'
      } catch (cause) {
        error = cause instanceof AiUnavailableError ? cause.code : (cause instanceof Error ? cause.message : 'AI_CALL_FAILED')
        result = localAnalyze(input)
      }
    } else {
      result = localAnalyze(input)
    }
    const analysisSummary = JSON.stringify(result)
    const completedAt = Date.now()
    await db.update(businessProfiles).set({
            analysisStatus: 'complete', analysisSummary, analysisMode: mode,
            analysisError: error, analyzedAt: completedAt, updatedAt: completedAt,
          }).where(eq(businessProfiles.id, existing.id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'icp.profile.analyzed', existing.id, { mode, hasAi: mode === 'ai', error })
    const updated = (await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.id, existing.id))))!
    return reply.code(202).send({ ...serializeProfile(updated), analysis: result, mode })
  })

  app.get('/knowledge', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(knowledgeItems.workspaceId, request.auth.workspaceId)]
    if (query.q) conditions.push(or(
      like(knowledgeItems.title, `%${query.q}%`),
      like(knowledgeItems.summary, `%${query.q}%`),
      like(knowledgeItems.tagsJson, `%${query.q}%`),
    )!)
    if (query.itemType) conditions.push(eq(knowledgeItems.itemType, query.itemType))
    if (query.status) conditions.push(eq(knowledgeItems.status, query.status))
    const where = and(...conditions)
    const orderBy =
      query.sort === 'updated_asc' ? asc(knowledgeItems.updatedAt)
      : query.sort === 'title_asc' ? asc(knowledgeItems.title)
      : query.sort === 'title_desc' ? desc(knowledgeItems.title)
      : query.sort === 'references_desc' ? desc(knowledgeItems.referenceCount)
      : query.sort === 'references_asc' ? asc(knowledgeItems.referenceCount)
      : desc(knowledgeItems.updatedAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(knowledgeItems).where(where)))?.count ?? 0
    const items = (await db.select().from(knowledgeItems).where(where).orderBy(orderBy)
          .limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(serializeKnowledge)
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/knowledge', async (request, reply) => {
    const parsed = knowledgeInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const row: KnowledgeRow = {
      id: createId('knw'), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId,
      title: parsed.data.title, itemType: parsed.data.itemType, summary: parsed.data.summary,
      source: parsed.data.source, sourceUrl: parsed.data.sourceUrl ?? null,
      tagsJson: JSON.stringify(parsed.data.tags), status: parsed.data.status,
      referenceCount: 0, createdAt: now, updatedAt: now,
    }
    await db.insert(knowledgeItems).values(row)
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.created', row.id, { title: row.title, itemType: row.itemType })
    return reply.code(201).send(serializeKnowledge(row))
  })

  app.get('/knowledge/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const row = (await db.$first(db.select().from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!row) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    return serializeKnowledge(row)
  })

  app.patch('/knowledge/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = knowledgePatch.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await db.$first(db.select().from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    const provided = pickProvided(request.body, parsed.data) as Partial<z.infer<typeof knowledgeInput>>
    if (!Object.keys(provided).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const now = Date.now()
    const patch: Partial<KnowledgeRow> = { updatedAt: now }
    if (provided.title !== undefined) patch.title = provided.title
    if (provided.itemType !== undefined) patch.itemType = provided.itemType
    if (provided.summary !== undefined) patch.summary = provided.summary
    if (provided.source !== undefined) patch.source = provided.source
    if (provided.sourceUrl !== undefined) patch.sourceUrl = provided.sourceUrl
    if (provided.status !== undefined) patch.status = provided.status
    if (provided.tags !== undefined) patch.tagsJson = JSON.stringify(provided.tags)
    await db.update(knowledgeItems).set(patch)
            .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.updated', id, { fields: Object.keys(provided) })
    return serializeKnowledge((await db.$first(db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))))!)
  })

  app.patch('/knowledge/:id/status', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = z.object({ status: z.enum(knowledgeStatuses) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const existing = (await db.$first(db.select().from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    const now = Date.now()
    await db.update(knowledgeItems).set({ status: parsed.data.status, updatedAt: now })
            .where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.status_changed', id, { status: parsed.data.status })
    return serializeKnowledge((await db.$first(db.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))))!)
  })

  app.delete('/knowledge/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = (await db.$first(db.select({ id: knowledgeItems.id }).from(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '知识条目不存在。' })
    await db.delete(knowledgeItems).where(and(eq(knowledgeItems.id, id), eq(knowledgeItems.workspaceId, request.auth.workspaceId)))
    await writeKnowledgeAudit(request.auth.workspaceId, request.auth.userId, 'knowledge.deleted', id, {})
    return reply.code(204).send()
  })
}
