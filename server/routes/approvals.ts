import type { FastifyPluginAsync } from 'fastify'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client.js'
import { approvalRequests, auditLogs, users } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { requireAuth, requirePermission } from '../plugins/auth.js'

export const approvalRoutes: FastifyPluginAsync = async app => {
  app.get('/', { preHandler: requireAuth }, async request => {
    const rows = await db.select({ request: approvalRequests, requester: users.displayName }).from(approvalRequests).innerJoin(users, eq(users.id, approvalRequests.requestedByUserId)).where(eq(approvalRequests.workspaceId, request.auth.workspaceId)).orderBy(desc(approvalRequests.createdAt)).limit(200)
    return { items: rows.map(row => ({ ...row.request, requester: row.requester })) }
  })
  app.post('/', { preHandler: requirePermission('approvals.request') }, async (request, reply) => {
    const parsed = z.object({ entityType: z.string().trim().min(2).max(50), entityId: z.string().trim().min(1).max(100), action: z.string().trim().min(2).max(80), note: z.string().trim().max(500).optional() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const now = Date.now(); const id = createId('apr')
    await db.insert(approvalRequests).values({ id, workspaceId: request.auth.workspaceId, ...parsed.data, requestedByUserId: request.auth.userId, createdAt: now, updatedAt: now })
    await db.insert(auditLogs).values({ id: createId('aud'), workspaceId: request.auth.workspaceId, actorUserId: request.auth.userId, action: 'approval.requested', entityType: parsed.data.entityType, entityId: parsed.data.entityId, metadata: JSON.stringify({ approvalId: id, action: parsed.data.action }), ipAddress: request.ip, createdAt: now })
    return reply.code(201).send({ id, ...parsed.data, status: 'pending', createdAt: now })
  })
  app.patch('/:id', { preHandler: requirePermission('approvals.review') }, async (request, reply) => {
    const parsed = z.object({ status: z.enum(['approved', 'rejected', 'cancelled']), note: z.string().trim().max(500).optional() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const id = (request.params as { id: string }).id; const current = await db.$first(db.select().from(approvalRequests).where(and(eq(approvalRequests.id, id), eq(approvalRequests.workspaceId, request.auth.workspaceId))))
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND', message: '审批请求不存在。' })
    if (current.status !== 'pending') return reply.code(409).send({ error: 'APPROVAL_CLOSED', message: '审批请求已经结束。' })
    const now = Date.now(); await db.update(approvalRequests).set({ status: parsed.data.status, note: parsed.data.note ?? current.note, reviewedByUserId: request.auth.userId, reviewedAt: now, updatedAt: now }).where(eq(approvalRequests.id, id))
    await db.insert(auditLogs).values({ id: createId('aud'), workspaceId: request.auth.workspaceId, actorUserId: request.auth.userId, action: `approval.${parsed.data.status}`, entityType: current.entityType, entityId: current.entityId, metadata: JSON.stringify({ approvalId: id, note: parsed.data.note ?? null }), ipAddress: request.ip, createdAt: now })
    return { ...current, ...parsed.data, reviewedByUserId: request.auth.userId, reviewedAt: now, updatedAt: now }
  })
}
