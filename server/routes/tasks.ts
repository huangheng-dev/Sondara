import type { FastifyPluginAsync } from 'fastify'
import { and, asc, desc, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { auditLogs, customers, tasks } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { pickProvided } from '../lib/input.js'
import { requireAuth } from '../plugins/auth.js'
import { booleanQuerySchema } from '../contracts/query.js'

const taskInput = z.object({
  customerId: z.string().trim().min(1).nullable().optional(),
  entityType: z.string().trim().max(80).nullable().optional(),
  entityId: z.string().trim().max(160).nullable().optional(),
  actionPath: z.string().trim().max(500).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  priority: z.enum(['高', '中', '低']).default('中'),
  dueAt: z.number().int().nullable().optional(),
  dueLabel: z.string().trim().max(80).default('待安排'),
  company: z.string().trim().max(160).default('个人事项'),
  nextAction: z.string().trim().max(240).default('按计划执行'),
  impact: z.string().trim().max(80).default('待评估'),
  source: z.string().trim().max(80).default('客户'),
})
const taskPatch = taskInput.partial().extend({ status: z.enum(['open', 'completed']).optional() })
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['open', 'completed']).optional(),
  includeArchived: booleanQuerySchema,
  archivedOnly: booleanQuerySchema,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['created_desc', 'due_asc', 'priority_desc']).default('created_desc'),
})

const writeAudit = async (workspaceId: string, actorUserId: string, action: string, entityId: string, metadata: unknown = {}) => {
  await db.insert(auditLogs).values({ id: createId('aud'), workspaceId, actorUserId, action, entityType: 'task', entityId, metadata: JSON.stringify(metadata), createdAt: Date.now() })
}

export const taskRoutes: FastifyPluginAsync = async app => {
  app.addHook('preHandler', requireAuth)

  app.get('/', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_QUERY', message: parsed.error.issues[0]?.message })
    const query = parsed.data
    const conditions = [eq(tasks.workspaceId, request.auth.workspaceId)]
    if (query.archivedOnly) conditions.push(isNotNull(tasks.archivedAt))
    else if (!query.includeArchived) conditions.push(isNull(tasks.archivedAt))
    if (query.q) conditions.push(or(like(tasks.title, `%${query.q}%`), like(tasks.company, `%${query.q}%`), like(tasks.nextAction, `%${query.q}%`))!)
    if (query.status) conditions.push(eq(tasks.status, query.status))
    const where = and(...conditions)
    const orderBy = query.sort === 'due_asc' ? asc(tasks.dueAt) : query.sort === 'priority_desc' ? asc(tasks.priority) : desc(tasks.createdAt)
    const total = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(tasks).where(where)))?.count ?? 0
    const items = (await db.select().from(tasks).where(where).orderBy(orderBy).limit(query.pageSize).offset((query.page - 1) * query.pageSize))
    return { items, page: query.page, pageSize: query.pageSize, total }
  })

  app.post('/', async (request, reply) => {
    const parsed = taskInput.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    let relatedCustomer: { id: string } | undefined
    if (parsed.data.customerId) {
      const customer = (await db.$first(db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, parsed.data.customerId), eq(customers.workspaceId, request.auth.workspaceId)))))
      if (!customer) return reply.code(404).send({ error: 'CUSTOMER_NOT_FOUND', message: '关联客户不存在。' })
      relatedCustomer = customer
    }
    const now = Date.now()
    const record = { id: createId('tsk'), workspaceId: request.auth.workspaceId, ownerUserId: request.auth.userId, status: 'open', createdAt: now, updatedAt: now,
      ...(relatedCustomer ? { entityType: 'customer', entityId: relatedCustomer.id, actionPath: `/customers?open=${encodeURIComponent(relatedCustomer.id)}` } : {}), ...parsed.data }
    await db.insert(tasks).values(record)
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'task.created', record.id, { title: record.title, customerId: record.customerId })
    return reply.code(201).send(record)
  })

  app.patch('/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const parsed = taskPatch.safeParse(request.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    const existing = (await db.$first(db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.workspaceId, request.auth.workspaceId)))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '任务不存在。' })
    if (parsed.data.customerId) {
      const customer = (await db.$first(db.select({ id: customers.id }).from(customers).where(and(eq(customers.id, parsed.data.customerId), eq(customers.workspaceId, request.auth.workspaceId)))))
      if (!customer) return reply.code(404).send({ error: 'CUSTOMER_NOT_FOUND', message: '关联客户不存在。' })
    }
    const changes = pickProvided(request.body, parsed.data)
    if (!Object.keys(changes).length) return reply.code(400).send({ error: 'INVALID_INPUT', message: '没有可更新的字段。' })
    await db.update(tasks).set({ ...changes, updatedAt: Date.now() }).where(and(eq(tasks.id, id), eq(tasks.workspaceId, request.auth.workspaceId)))
    await writeAudit(request.auth.workspaceId, request.auth.userId, 'task.updated', id, { fields: Object.keys(changes) })
    return (await db.$first(db.select().from(tasks).where(eq(tasks.id, id))))
  })

  app.post('/:id/archive', async (request, reply) => {
    const id = (request.params as { id: string }).id
    const existing = await db.$first(db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, id), eq(tasks.workspaceId, request.auth.workspaceId))))
    if (!existing) return reply.code(404).send({ error: 'NOT_FOUND', message: '任务不存在。' })
    const archivedAt = (request.body as { archived?: boolean } | undefined)?.archived === false ? null : Date.now()
    await db.update(tasks).set({ archivedAt, updatedAt: Date.now() }).where(eq(tasks.id, id))
    await writeAudit(request.auth.workspaceId, request.auth.userId, archivedAt ? 'task.archived' : 'task.unarchived', id)
    return { id, archivedAt }
  })
}
