import type { FastifyReply, FastifyRequest } from 'fastify'
import { findSessionContext, sessionCookieName } from '../lib/session.js'

export const requireAuth = async (request: FastifyRequest, reply: FastifyReply) => {
  const token = request.cookies[sessionCookieName]
  if (!token) return reply.code(401).send({ error: 'UNAUTHENTICATED', message: '请先登录。' })
  const context = (await findSessionContext(token))
  if (!context) return reply.code(401).send({ error: 'SESSION_EXPIRED', message: '登录已过期，请重新登录。' })
  if (context.role === 'viewer' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return reply.code(403).send({ error: 'FORBIDDEN', message: '只读成员不能修改工作区数据。' })
  }
  request.auth = context
}

export const requireAdmin = async (request: FastifyRequest, reply: FastifyReply) => {
  await requireAuth(request, reply)
  if (reply.sent) return
  if (!['owner', 'admin'].includes(request.auth.role)) {
    return reply.code(403).send({ error: 'FORBIDDEN', message: '仅工作区所有者或管理员可执行此操作。' })
  }
}
