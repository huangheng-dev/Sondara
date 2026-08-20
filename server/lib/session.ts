import { createHash, randomBytes } from 'node:crypto'
import { and, eq, gt, isNull, lt, or } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { sessions, users, workspaceMembers, workspaces } from '../db/schema.js'
import { createId } from './ids.js'

export const sessionCookieName = 'sondara_session'
export const challengeCookieName = 'sondara_2fa'
export const hashSessionToken = (token: string) => createHash('sha256').update(token).digest('hex')

export const createSession = (
  userId: string,
  days = config.sessionDays,
  metadata: { userAgent?: string | null; ipAddress?: string | null } = {},
) => {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const expiresAt = now + days * 86_400_000
  const id = createId('ses')
  db.insert(sessions).values({
    id,
    userId,
    tokenHash: hashSessionToken(token),
    userAgent: metadata.userAgent?.slice(0, 500) || null,
    ipAddress: metadata.ipAddress?.slice(0, 100) || null,
    lastSeenAt: now,
    expiresAt,
    createdAt: now,
  }).run()
  return { id, token, expiresAt }
}

export const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: number) => {
  reply.setCookie(sessionCookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires: new Date(expiresAt),
  })
}

export const clearSessionCookie = (reply: FastifyReply) => {
  reply.clearCookie(sessionCookieName, { path: '/' })
}

export const setChallengeCookie = (reply: FastifyReply, token: string, expiresAt: number) => {
  reply.setCookie(challengeCookieName, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    expires: new Date(expiresAt),
  })
}

export const clearChallengeCookie = (reply: FastifyReply) => {
  reply.clearCookie(challengeCookieName, { path: '/' })
}

export const findSessionContext = (token: string) => {
  const context = db.select({
    sessionId: sessions.id,
    userId: users.id,
    email: users.email,
    displayName: users.displayName,
    workspaceId: workspaces.id,
    workspaceName: workspaces.name,
    role: workspaceMembers.role,
  }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, Date.now()), eq(users.status, 'active')))
    .limit(1).get()
  if (context) {
    const now = Date.now()
    db.update(sessions).set({ lastSeenAt: now }).where(and(
      eq(sessions.id, context.sessionId),
      or(isNull(sessions.lastSeenAt), lt(sessions.lastSeenAt, now - 60_000)),
    )).run()
  }
  return context
}
