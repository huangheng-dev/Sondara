import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, gte, inArray, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, customerTags, customers, inboxContacts, users, workspaceMembers } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { pickProvided } from '../lib/input.js'
import { requireAuth } from '../plugins/auth.js'

const customerInput = z.object({
  company: z.string().trim().min(1).max(160),
  region: z.string().trim().max(80).default('待补全'),
  industry: z.string().trim().max(120).default('待补全'),
  score: z.number().int().min(0).max(100).default(0),
  confidence: z.number().int().min(0).max(100).default(0),
  signal: z.string().trim().max(160).default('待识别'),
  source: z.string().trim().max(120).default('手动录入'),
  estimatedValue: z.number().int().min(0).default(0),
  size: z.string().trim().max(80).default('待补全'),
  stage: z.string().trim().max(40).default('待补全'),
  contacts: z.number().int().min(0).default(0),
  validContacts: z.number().int().min(0).default(0),
  interaction: z.string().trim().max(160).default('尚无互动'),
  nextAction: z.string().trim().max(200).default('补全企业档案'),
  dueAt: z.number().int().nullable().optional(),
  ownerUserId: z.string().trim().min(1).nullable().optional(),
})
const customerPatch = customerInput.partial()
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  region: z.string().trim().optional(),
  stage: z.string().trim().optional(),
  minScore: z.coerce.number().int().min(0).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['updated_desc', 'updated_asc', 'score_desc', 'score_asc', 'company_asc']).default('updated_desc'),
})

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'customer', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

export const customerRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(customers.workspaceId, request.auth.workspaceId)]
    if (query.q) conditions.push(or(like(customers.company, `%${query.q}%`), like(customers.industry, `%${query.q}%`), like(customers.signal, `%${query.q}%`))!)
    if (query.region) conditions.push(eq(customers.region, query.region))
    if (query.stage) conditions.push(eq(customers.stage, query.stage))
    if (query.minScore !== undefined) conditions.push(gte(customers.score, query.minScore))
    const where = and(...conditions)
    const orderBy = query.sort === 'updated_asc' ? asc(customers.updatedAt)
      : query.sort === 'score_desc' ? desc(customers.score)
      : query.sort === 'score_asc' ? asc(customers.score)
      : query.sort === 'company_asc' ? asc(customers.company)
      : desc(customers.updatedAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(customers).where(where)))?.count ?? 0
    const names = new Map((await db.select({ id: users.id, name: users.displayName }).from(users)).map(item => [item.id, item.name]))
    const tags = (await db.select().from(customerTags).where(eq(customerTags.workspaceId, request.auth.workspaceId)))
    const tagsByCustomer = new Map<string, Array<{ id: string; name: string; color: string }>>()
    tags.forEach(tag => tagsByCustomer.set(tag.customerId, [...(tagsByCustomer.get(tag.customerId) ?? []), { id: tag.id, name: tag.name, color: tag.color }]))
    const items = (await db.select().from(customers).where(where).orderBy(orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize)).map(item => ({ ...item, ownerName: item.ownerUserId ? names.get(item.ownerUserId) ?? '未分配' : '未分配', tags: tagsByCustomer.get(item.id) ?? [] }))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/', async (request, reply) => {
    const parsed = customerInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const requestedOwner = parsed.data.ownerUserId ?? request.auth.userId
    if (requestedOwner && !(await db.$first(db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, requestedOwner)))))) return reply.code(400).send({ error: 'INVALID_OWNER', message: '负责人不是当前工作区成员。' })
    const record = { id: createId('cus'), workspaceId: request.auth.workspaceId, createdAt: now, updatedAt: now, ...parsed.data, ownerUserId: requestedOwner }
    try { await db.insert(customers).values(record) } catch { return reply.code(409).send({ error: 'CUSTOMER_EXISTS', message: '该工作区已存在同名客户。' }) }
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.created', record.id, { company: record.company })
    return reply.code(201).send(record)
  })

  app.patch('/:id', async (request, reply) => {
    const id = z.string().min(1).parse((request.params as { id: string }).id)
    const parsed = customerPatch.safeParse(request.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = (await db.$first(db.select().from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const changes = pickProvided(request.body, parsed.data)
    if (!Object.keys(changes).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    if (changes.ownerUserId && !(await db.$first(db.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(workspaceMembers.userId, changes.ownerUserId)))))) return reply.code(400).send({ error: 'INVALID_OWNER', message: '负责人不是当前工作区成员。' })
    await db.update(customers).set({ ...changes, updatedAt: Date.now() }).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.updated', id, { fields: Object.keys(changes) })
    return (await db.$first(db.select().from(customers).where(eq(customers.id, id))))
  })

  app.delete('/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = (await db.$first(db.select({ id: customers.id, company: customers.company }).from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    await db.delete(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.deleted', id, { company: existing.company })
    return reply.code(204).send()
  })

  app.post('/tags/bulk', async (request, reply) => {
    const parsed = z.object({ customerIds: z.array(z.string().min(1)).min(1).max(500), name: z.string().trim().min(1).max(50), color: z.enum(['blue', 'green', 'orange', 'gray']).default('blue') }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const validCustomers = (await db.select({ id: customers.id }).from(customers).where(and(eq(customers.workspaceId, request.auth.workspaceId), inArray(customers.id, parsed.data.customerIds))))
    if (validCustomers.length !== new Set(parsed.data.customerIds).size) return reply.code(404).send({ error: 'CUSTOMER_NOT_FOUND', message: '部分客户不存在或不属于当前工作区。' })
    const now = Date.now()
    await Promise.all(validCustomers.map(async customer => (await db.insert(customerTags).values({ id: createId('ctg'), workspaceId: request.auth.workspaceId, customerId: customer.id, name: parsed.data.name, color: parsed.data.color, createdAt: now }).onConflictDoUpdate({ target: [customerTags.customerId, customerTags.name], set: { color: parsed.data.color } }))))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.tags_added', validCustomers.map(item => item.id).join(','), { name: parsed.data.name, count: validCustomers.length })
    return reply.code(201).send({ updated: validCustomers.length })
  })

  app.get('/:id/contacts', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const customer = (await db.$first(db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!customer) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    return { items: (await db.select().from(inboxContacts).where(and(eq(inboxContacts.workspaceId, request.auth.workspaceId), eq(inboxContacts.customerId, id)))) }
  })

  app.post('/:id/contacts', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const customer = (await db.$first(db.select().from(customers).where(and(eq(customers.id, id), eq(customers.workspaceId, request.auth.workspaceId)))))
    if (!customer) return reply.code(404).send({ error: 'NOT_FOUND', message: '客户不存在。' })
    const parsed = z.object({ name: z.string().trim().min(1).max(100), jobTitle: z.string().trim().max(120).default('待补全'), email: z.string().trim().email().nullable().optional(), phone: z.string().trim().max(50).nullable().optional(), primaryChannel: z.string().trim().max(50).default('邮件') }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now()
    const record = { id: createId('ict'), workspaceId: request.auth.workspaceId, customerId: id, name: parsed.data.name, company: customer.company, jobTitle: parsed.data.jobTitle, region: customer.region, source: '客户库手动添加', primaryChannel: parsed.data.primaryChannel, email: parsed.data.email ?? null, phone: parsed.data.phone ?? null, externalRef: null, createdAt: now, updatedAt: now }
    try { await db.insert(inboxContacts).values(record) } catch { return reply.code(409).send({ error: 'CONTACT_EXISTS', message: '该客户已存在同名联系人。' }) }
    const counts = (await db.$first(db.select({ total: sql<number>`count(*)`, valid: sql<number>`sum(case when ${inboxContacts.email} is not null or ${inboxContacts.phone} is not null then 1 else 0 end)` }).from(inboxContacts).where(eq(inboxContacts.customerId, id))))
    await db.update(customers).set({ contacts: counts?.total ?? 0, validContacts: counts?.valid ?? 0, updatedAt: now }).where(eq(customers.id, id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'customer.contact_created', record.id, { customerId: id })
    return reply.code(201).send(record)
  })
}
