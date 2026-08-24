import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, customers, deals } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { pickProvided } from '../lib/input.js'
import { requireAuth } from '../plugins/auth.js'
import { stopCampaignAudienceForCustomer } from '../campaigns/audience-lifecycle.js'
import { booleanQuerySchema } from '../contracts/query.js'

const dealStages = ['线索确认', '需求确认', '方案评估', '商务谈判', '赢单'] as const
const probabilityByStage: Record<(typeof dealStages)[number], number> = { 线索确认: 20, 需求确认: 40, 方案评估: 60, 商务谈判: 80, 赢单: 100 }
const dealInput = z.object({
  customerId: z.string().trim().min(1).nullable().optional(),
  company: z.string().trim().min(1).max(160),
  stage: z.enum(dealStages).default('线索确认'),
  probability: z.number().int().min(0).max(100).optional(),
  valueAmount: z.number().int().min(0).default(0),
  currency: z.enum(['CNY', 'EUR', 'USD']).default('CNY'),
  ownerLabel: z.string().trim().max(80).default('我'),
  nextAction: z.string().trim().max(240).default('确认需求和决策链'),
  expectedCloseAt: z.number().int().nullable().optional(),
  risk: z.string().trim().max(240).default('等待首次复核'),
  source: z.string().trim().max(120).default('商机跟进'),
})
const dealPatch = dealInput.partial()
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z.enum(dealStages).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'value_desc', 'probability_desc', 'close_asc']).default('updated_desc'),
  includeArchived: booleanQuerySchema,
  archivedOnly: booleanQuerySchema,
})

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'deal', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

export const dealRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(deals.workspaceId, request.auth.workspaceId)]
    if (query.archivedOnly) conditions.push(isNotNull(deals.archivedAt))
    else if (!query.includeArchived) conditions.push(isNull(deals.archivedAt))
    if (query.q) conditions.push(or(like(deals.company, `%${query.q}%`), like(deals.nextAction, `%${query.q}%`), like(deals.risk, `%${query.q}%`))!)
    if (query.stage) conditions.push(eq(deals.stage, query.stage))
    const where = and(...conditions)
    const orderBy = query.sort === 'value_desc' ? desc(deals.valueAmount) : query.sort === 'probability_desc' ? desc(deals.probability) : query.sort === 'close_asc' ? asc(deals.expectedCloseAt) : desc(deals.updatedAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(deals).where(where)))?.count ?? 0
    const items = (await db.select().from(deals).where(where).orderBy(orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/', async (request, reply) => {
    const parsed = dealInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const input = parsed.data
    const duplicate = (await db.$first(db.select({ id: deals.id }).from(deals).where(and(eq(deals.workspaceId, request.auth.workspaceId), eq(deals.company, input.company)))))
    if (duplicate) return reply.code(409).send({ error: 'DEAL_EXISTS', message: '该企业已经存在商机。' })
    const now = Date.now()
    let customer = input.customerId
      ? (await db.$first(db.select().from(customers).where(and(eq(customers.id, input.customerId), eq(customers.workspaceId, request.auth.workspaceId)))))
      : (await db.$first(db.select().from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), eq(customers.company, input.company)))))
    if (input.customerId && !customer) return reply.code(404).send({ error: 'CUSTOMER_NOT_FOUND', message: '关联客户不存在。' })
    const customerId = customer?.id ?? createId('cus')
    const dealId = createId('dea')
    const probability = input.probability ?? probabilityByStage[input.stage]
    await db.transaction(async tx => {
            if (!customer) {
              await tx.insert(customers).values({
                          id: customerId, workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId,
                          company: input.company, region: '待补全', industry: '待补全', score: 75, confidence: 70,
                          signal: '客户回复转商机', source: input.source, estimatedValue: input.valueAmount, size: '待补全',
                          stage: '有商机', contacts: 1, validContacts: 1, interaction: '刚刚 · 已创建商机', nextAction: input.nextAction,
                          dueAt: null, createdAt: now, updatedAt: now,
                        })
            } else {
              await tx.update(customers).set({ stage: '有商机', estimatedValue: input.valueAmount, interaction: '刚刚 · 已创建商机', nextAction: input.nextAction, updatedAt: now }).where(eq(customers.id, customerId))
            }
            await tx.insert(deals).values({
                      id: dealId, workspaceId: request.auth.workspaceId, customerId, ownerUserId: request.auth.userId,
                      company: input.company, stage: input.stage, probability, valueAmount: input.valueAmount, currency: input.currency,
                      ownerLabel: input.ownerLabel, nextAction: input.nextAction, expectedCloseAt: input.expectedCloseAt ?? null,
                      risk: input.risk, source: input.source, stageEnteredAt: now, createdAt: now, updatedAt: now,
                    })
          })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'deal.created', dealId, { company: input.company, customerId })
    await stopCampaignAudienceForCustomer({ workspaceId: request.auth.workspaceId, customerId, reason: '创建商机' })
    return reply.code(201).send((await db.$first(db.select().from(deals).where(eq(deals.id, dealId)))))
  })

  app.patch('/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = dealPatch.safeParse(request.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = (await db.$first(db.select().from(deals).where(and(eq(deals.id, id), eq(deals.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '商机不存在。' })
    const now = Date.now()
    const changes = pickProvided(request.body, parsed.data)
    if (!Object.keys(changes).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const stageChanged = changes.stage !== undefined && changes.stage !== existing.stage
    const probability = changes.probability ?? (changes.stage ? probabilityByStage[changes.stage] : undefined)
    await db.transaction(async tx => {
            await tx.update(deals).set({ ...changes, ...(probability !== undefined ? { probability } : {}), ...(stageChanged ? { stageEnteredAt: now } : {}), updatedAt: now }).where(and(eq(deals.id, id), eq(deals.workspaceId, request.auth.workspaceId)))
            if (existing.customerId) {
              await tx.update(customers).set({
                          ...(changes.nextAction !== undefined ? { nextAction: changes.nextAction } : {}),
                          ...(changes.valueAmount !== undefined ? { estimatedValue: changes.valueAmount } : {}),
                          ...(changes.stage !== undefined ? { stage: '有商机' } : {}),
                          interaction: '刚刚 · 商机已更新', updatedAt: now,
                        }).where(and(eq(customers.id, existing.customerId), eq(customers.workspaceId, request.auth.workspaceId)))
            }
          })
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'deal.updated', id, { fields: Object.keys(changes) })
    return (await db.$first(db.select().from(deals).where(eq(deals.id, id))))
  })

  app.post('/:id/archive', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = await db.$first(db.select({ id: deals.id }).from(deals).where(and(eq(deals.id, id), eq(deals.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '商机不存在。' })
    const archivedAt = (request.body as { archived?: boolean } | undefined)?.archived === false ? null : Date.now()
    await db.update(deals).set({ archivedAt, updatedAt: Date.now() }).where(eq(deals.id, id)); await writeAudit(request.auth.workspaceId, request.auth.userId, archivedAt ? 'deal.archived' : 'deal.unarchived', id)
    return { id, archivedAt }
  })
}
