import type { FastifyPluginAsync } from 'fastify'
import { and, asc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import nodemailer from 'nodemailer'
import { z } from 'zod'
import { db } from '../db/client.js'
import { authChallenges, outboundChannelConnections, passwordResetTokens, sessions, users, workspaceMembers, workspaces } from '../db/schema.js'
import { requireAuth } from '../plugins/auth.js'
import { createId } from '../lib/ids.js'
import { hashPassword, verifyPassword } from '../lib/password.js'
import { decryptSecret, encryptSecret } from '../lib/secret-vault.js'
import { config } from '../config.js'
import {
  challengeCookieName,
  clearChallengeCookie,
  clearSessionCookie,
  createSession,
  hashSessionToken,
  sessionCookieName,
  setChallengeCookie,
  setSessionCookie,
} from '../lib/session.js'
import { generateTotpSecret, getTotpOtpauth, verifyTotp } from '../lib/totp.js'

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('请输入有效邮箱。'),
  password: z.string().min(8, '密码至少需要 8 位。').max(128),
})
const loginSchema = credentialsSchema.extend({ remember: z.boolean().default(true) })
const registerSchema = credentialsSchema.extend({ displayName: z.string().trim().min(2).max(50) })

const parseJson = <T>(value: string, fallback: T): T => {
  try { return JSON.parse(value) as T } catch { return fallback }
}

const createRecoveryCodes = () => Array.from({ length: 8 }, () => {
  const value = randomBytes(4).toString('hex').toUpperCase()
  return `${value.slice(0, 4)}-${value.slice(4)}`
})

const normalizeRecoveryCode = (value: string) => value.replace(/\s|-/g, '').toUpperCase()

const getPrimaryWorkspace = async (userId: string) => (await db.$first(db.select({ workspaceId: workspaces.id, workspaceName: workspaces.name, role: workspaceMembers.role })
  .from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
  .where(eq(workspaceMembers.userId, userId)).limit(1)))

const getTotpSecret = (user: typeof users.$inferSelect) => {
  if (!user.totpSecretCiphertext || !user.totpSecretIv || !user.totpSecretTag) return null
  return decryptSecret({ ciphertext: user.totpSecretCiphertext, iv: user.totpSecretIv, tag: user.totpSecretTag })
}

const sessionMetadata = (request: { headers: Record<string, unknown>; ip: string }) => ({
  userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
  ipAddress: request.ip,
})

const sendPasswordResetEmail = async (user: typeof users.$inferSelect, token: string) => {
  const member = (await getPrimaryWorkspace(user.id))
  if (!member) return false
  const connection = (await db.$first(db.select().from(outboundChannelConnections)
      .where(and(
        eq(outboundChannelConnections.workspaceId, member.workspaceId),
        eq(outboundChannelConnections.enabled, true),
        eq(outboundChannelConnections.provider, 'smtp'),
      )).orderBy(asc(outboundChannelConnections.priority))))
  if (!connection) return false
  const resetUrl = `${config.webOrigin.replace(/\/$/, '')}/reset-password?token=${encodeURIComponent(token)}`
  const transport = nodemailer.createTransport({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: {
      user: connection.username,
      pass: decryptSecret({ ciphertext: connection.secretCiphertext, iv: connection.secretIv, tag: connection.secretTag }),
    },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  try {
    await transport.sendMail({
      from: { name: connection.fromName, address: connection.fromEmail },
      to: user.email,
      replyTo: connection.replyTo ?? undefined,
      subject: '重置你的 Sondara 登录密码',
      text: `你好，${user.displayName}：\n\n请在 30 分钟内打开下面的链接重置密码：\n${resetUrl}\n\n如果不是你发起的请求，可以忽略这封邮件。`,
    })
    return true
  } finally { transport.close() }
}

export const authRoutes: FastifyPluginAsync = async app => {
  app.post('/register', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const { email, password, displayName } = parsed.data
    if ((await db.$first(db.select({ id: users.id }).from(users).where(eq(users.email, email))))) {
      return reply.code(409).send({ error: 'EMAIL_EXISTS', message: '该邮箱已注册。' })
    }
    const now = Date.now()
    const userId = createId('usr')
    const workspaceId = createId('wsp')
    const passwordHash = await hashPassword(password)
    await db.transaction(async tx => {
            await tx.insert(users).values({ id: userId, email, passwordHash, displayName, createdAt: now, updatedAt: now })
            await tx.insert(workspaces).values({ id: workspaceId, name: `${displayName}的工作区`, ownerUserId: userId, createdAt: now, updatedAt: now })
            await tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner', createdAt: now })
          })
    const session = (await createSession(userId, undefined, sessionMetadata(request)))
    setSessionCookie(reply, session.token, session.expiresAt)
    return reply.code(201).send({ user: { id: userId, email, displayName }, workspace: { id: workspaceId, name: `${displayName}的工作区`, role: 'owner' } })
  })

  app.post('/login', { config: { rateLimit: { max: 12, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: '邮箱或密码格式不正确。' })
    const user = (await db.$first(db.select().from(users).where(eq(users.email, parsed.data.email))))
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: '邮箱或密码不正确。' })
    }
    if (user.status !== 'active') return reply.code(403).send({ error: 'ACCOUNT_DISABLED', message: '账户已停用，请联系工作区管理员。' })
    if (user.totpEnabled && user.totpSecretCiphertext) {
      const now = Date.now()
      const token = randomBytes(32).toString('base64url')
      const expiresAt = now + 10 * 60_000
      await db.insert(authChallenges).values({ id: createId('ach'), userId: user.id, purpose: 'login_2fa', tokenHash: hashSessionToken(token), expiresAt, createdAt: now })
      setChallengeCookie(reply, token, expiresAt)
      return reply.code(202).send({ twoFactorRequired: true, maskedEmail: user.email.replace(/^(.).*?(@.*)$/, '$1***$2') })
    }
    const session = (await createSession(user.id, parsed.data.remember ? undefined : 1, sessionMetadata(request)))
    setSessionCookie(reply, session.token, session.expiresAt)
    const member = (await getPrimaryWorkspace(user.id))
    if (!member) return reply.code(403).send({ error: 'NO_WORKSPACE', message: '账户尚未关联工作空间。' })
    return { user: { id: user.id, email: user.email, displayName: user.displayName }, workspace: { id: member.workspaceId, name: member.workspaceName, role: member.role } }
  })

  app.post('/2fa/verify', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const parsed = z.object({ code: z.string().trim().min(6).max(20), remember: z.boolean().default(true) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: '请输入 6 位验证码或恢复码。' })
    const token = request.cookies[challengeCookieName]
    if (!token) return reply.code(401).send({ error: 'CHALLENGE_REQUIRED', message: '二次验证已过期，请重新登录。' })
    const challenge = (await db.$first(db.select().from(authChallenges).where(and(eq(authChallenges.tokenHash, hashSessionToken(token)), eq(authChallenges.purpose, 'login_2fa'), gt(authChallenges.expiresAt, Date.now())))))
    if (!challenge) {
      clearChallengeCookie(reply)
      return reply.code(401).send({ error: 'CHALLENGE_EXPIRED', message: '二次验证已过期，请重新登录。' })
    }
    const user = (await db.$first(db.select().from(users).where(eq(users.id, challenge.userId))))
    if (!user || user.status !== 'active' || !user.totpEnabled) {
      await db.delete(authChallenges).where(eq(authChallenges.id, challenge.id))
      clearChallengeCookie(reply)
      return reply.code(401).send({ error: 'INVALID_USER', message: '账户不可用，请重新登录。' })
    }
    const code = parsed.data.code.trim()
    let valid = false
    let usedRecovery = false
    const secret = getTotpSecret(user)
    if (secret && /^\d{6}$/.test(code)) valid = verifyTotp(code, secret)
    if (!valid) {
      const normalized = normalizeRecoveryCode(code)
      if (/^[0-9A-F]{8}$/.test(normalized)) {
        const hashes = parseJson<string[]>(user.totpRecoveryCodesJson, [])
        for (const hash of hashes) {
          if (await verifyPassword(normalized, hash)) {
            valid = true
            usedRecovery = true
            await db.update(users).set({ totpRecoveryCodesJson: JSON.stringify(hashes.filter(item => item !== hash)), updatedAt: Date.now() }).where(eq(users.id, user.id))
            break
          }
        }
      }
    }
    if (!valid) return reply.code(401).send({ error: 'INVALID_CODE', message: '验证码不正确或已过期。' })
    await db.delete(authChallenges).where(eq(authChallenges.id, challenge.id))
    clearChallengeCookie(reply)
    const session = (await createSession(user.id, parsed.data.remember ? undefined : 1, sessionMetadata(request)))
    setSessionCookie(reply, session.token, session.expiresAt)
    const member = (await getPrimaryWorkspace(user.id))
    if (!member) return reply.code(403).send({ error: 'NO_WORKSPACE', message: '账户尚未关联工作空间。' })
    return reply.code(201).send({ user: { id: user.id, email: user.email, displayName: user.displayName }, workspace: { id: member.workspaceId, name: member.workspaceName, role: member.role }, usedRecovery })
  })

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[sessionCookieName]
    if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)))
    clearSessionCookie(reply)
    clearChallengeCookie(reply)
    return reply.code(204).send()
  })

  app.get('/session', { preHandler: requireAuth }, async request => ({
    user: (async () => {
      const user = (await db.$first(db.select({ locale: users.locale, timezone: users.timezone, currency: users.currency }).from(users).where(eq(users.id, request.auth.userId))))
      return { id: request.auth.userId, email: request.auth.email, displayName: request.auth.displayName, locale: user?.locale ?? 'zh-CN', timezone: user?.timezone ?? 'Asia/Shanghai', currency: user?.currency ?? 'CNY' }
    })(),
    workspace: { id: request.auth.workspaceId, name: request.auth.workspaceName, role: request.auth.role },
  }))

  app.post('/forgot-password', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email() }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: '请输入有效邮箱。' })
    const user = (await db.$first(db.select().from(users).where(eq(users.email, parsed.data.email))))
    if (!user || user.status !== 'active') return { ok: true, delivery: 'accepted' }
    const token = randomBytes(32).toString('base64url')
    const now = Date.now()
    await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id))
    await db.insert(passwordResetTokens).values({ id: createId('prt'), userId: user.id, tokenHash: hashSessionToken(token), expiresAt: now + 30 * 60_000, createdAt: now })
    let delivered = false
    try { delivered = await sendPasswordResetEmail(user, token) } catch { delivered = false }
    return {
      ok: true,
      delivery: delivered ? 'email' : 'manual',
      ...(!config.isProduction && !delivered ? { resetUrl: `/reset-password?token=${encodeURIComponent(token)}` } : {}),
    }
  })

  app.post('/reset-password', { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = z.object({ token: z.string().min(20).max(200), newPassword: z.string().min(8).max(128) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const record = (await db.$first(db.select().from(passwordResetTokens).where(and(
          eq(passwordResetTokens.tokenHash, hashSessionToken(parsed.data.token)),
          gt(passwordResetTokens.expiresAt, Date.now()),
          isNull(passwordResetTokens.usedAt),
        ))))
    if (!record) return reply.code(400).send({ error: 'RESET_TOKEN_INVALID', message: '重置链接无效或已过期，请重新申请。' })
    const passwordHash = await hashPassword(parsed.data.newPassword)
    const now = Date.now()
    await db.transaction(async tx => {
            await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, record.userId))
            await tx.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, record.id))
            await tx.delete(sessions).where(eq(sessions.userId, record.userId))
          })
    return { ok: true }
  })

  app.patch('/profile', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({
      displayName: z.string().trim().min(2).max(50),
      email: z.string().trim().toLowerCase().email(),
      locale: z.enum(['zh-CN', 'en']),
      timezone: z.string().trim().min(1).max(80),
      currency: z.enum(['CNY', 'EUR', 'USD']),
      businessName: z.string().trim().min(1).max(120),
    }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const duplicate = (await db.$first(db.select({ id: users.id }).from(users).where(and(eq(users.email, parsed.data.email), ne(users.id, request.auth.userId)))))
    if (duplicate) return reply.code(409).send({ error: 'EMAIL_EXISTS', message: '该邮箱已被其他账户使用。' })
    const now = Date.now()
    await db.transaction(async tx => {
            await tx.update(users).set({ displayName: parsed.data.displayName, email: parsed.data.email, locale: parsed.data.locale, timezone: parsed.data.timezone, currency: parsed.data.currency, updatedAt: now }).where(eq(users.id, request.auth.userId))
            if (request.auth.role === 'owner') await tx.update(workspaces).set({ name: parsed.data.businessName, updatedAt: now }).where(eq(workspaces.id, request.auth.workspaceId))
          })
    return { user: { id: request.auth.userId, displayName: parsed.data.displayName, email: parsed.data.email, locale: parsed.data.locale, timezone: parsed.data.timezone, currency: parsed.data.currency }, workspace: { id: request.auth.workspaceId, name: request.auth.role === 'owner' ? parsed.data.businessName : request.auth.workspaceName, role: request.auth.role } }
  })

  app.get('/sessions', { preHandler: requireAuth }, async request => ({ items: (await db.select().from(sessions).where(eq(sessions.userId, request.auth.userId)).orderBy(asc(sessions.createdAt))).map(item => ({ id: item.id, current: item.id === request.auth.sessionId, userAgent: item.userAgent, ipAddress: item.ipAddress, lastSeenAt: item.lastSeenAt, createdAt: item.createdAt, expiresAt: item.expiresAt })) }))

  app.get('/workspace-members', { preHandler: requireAuth }, async request => ({ items: (await db.select({ id: users.id, displayName: users.displayName, email: users.email, role: workspaceMembers.role }).from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(and(eq(workspaceMembers.workspaceId, request.auth.workspaceId), eq(users.status, 'active')))) }))

  app.delete('/sessions/:id', { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as { id: string }).id
    const record = (await db.$first(db.select().from(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, request.auth.userId)))))
    if (!record) return reply.code(404).send({ error: 'NOT_FOUND', message: '登录会话不存在。' })
    await db.delete(sessions).where(eq(sessions.id, id))
    if (id === request.auth.sessionId) clearSessionCookie(reply)
    return reply.code(204).send()
  })

  app.delete('/sessions', { preHandler: requireAuth }, async request => {
    const removed = (await db.delete(sessions).where(and(eq(sessions.userId, request.auth.userId), ne(sessions.id, request.auth.sessionId)))).rowCount ?? 0
    return { removed }
  })

  app.get('/2fa/status', { preHandler: requireAuth }, async request => {
    const user = (await db.$first(db.select({ totpEnabled: users.totpEnabled, totpVerifiedAt: users.totpVerifiedAt }).from(users).where(eq(users.id, request.auth.userId))))
    return { enabled: user?.totpEnabled ?? false, verifiedAt: user?.totpVerifiedAt ?? null }
  })

  app.post('/2fa/setup', { preHandler: requireAuth }, async (request, reply) => {
    const user = (await db.$first(db.select({ email: users.email, totpEnabled: users.totpEnabled, totpVerifiedAt: users.totpVerifiedAt }).from(users).where(eq(users.id, request.auth.userId))))
    if (!user) return reply.code(404).send({ error: 'NOT_FOUND', message: '用户不存在。' })
    if (user.totpEnabled) return { enabled: true, verifiedAt: user.totpVerifiedAt }
    const secret = generateTotpSecret()
    return { enabled: false, secret, otpauth: getTotpOtpauth(user.email, secret), accountName: user.email }
  })

  app.post('/2fa/enable', { preHandler: requireAuth, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const parsed = z.object({
      currentPassword: z.string().min(1, '请输入当前密码。'),
      secret: z.string().trim().min(16).max(64).regex(/^[A-Z2-7\s]+$/, '设置密钥格式不正确。'),
      code: z.string().trim().regex(/^\d{6}$/, '请输入 6 位数字验证码。'),
    }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const user = (await db.$first(db.select().from(users).where(eq(users.id, request.auth.userId))))
    if (!user) return reply.code(404).send({ error: 'NOT_FOUND', message: '用户不存在。' })
    if (user.totpEnabled) return reply.code(409).send({ error: 'ALREADY_ENABLED', message: '双重验证已启用。' })
    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) return reply.code(401).send({ error: 'INVALID_PASSWORD', message: '当前密码不正确。' })
    const secret = parsed.data.secret.replace(/\s/g, '').toUpperCase()
    if (!verifyTotp(parsed.data.code, secret)) return reply.code(400).send({ error: 'INVALID_CODE', message: '验证码不正确，请确认服务器时间和验证器设置。' })
    const encrypted = encryptSecret(secret)
    const recoveryCodes = createRecoveryCodes()
    const recoveryHashes = await Promise.all(recoveryCodes.map(code => hashPassword(normalizeRecoveryCode(code))))
    const now = Date.now()
    await db.update(users).set({
            totpSecretCiphertext: encrypted.ciphertext,
            totpSecretIv: encrypted.iv,
            totpSecretTag: encrypted.tag,
            totpEnabled: true,
            totpVerifiedAt: now,
            totpRecoveryCodesJson: JSON.stringify(recoveryHashes),
            updatedAt: now,
          }).where(eq(users.id, user.id))
    return reply.code(201).send({ enabled: true, verifiedAt: now, recoveryCodes })
  })

  app.post('/2fa/disable', { preHandler: requireAuth, config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (request, reply) => {
    const parsed = z.object({
      currentPassword: z.string().min(1, '请输入当前密码。'),
      code: z.string().trim().min(6).max(20),
    }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const user = (await db.$first(db.select().from(users).where(eq(users.id, request.auth.userId))))
    if (!user) return reply.code(404).send({ error: 'NOT_FOUND', message: '用户不存在。' })
    if (!user.totpEnabled) return reply.code(409).send({ error: 'NOT_ENABLED', message: '双重验证尚未启用。' })
    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) return reply.code(401).send({ error: 'INVALID_PASSWORD', message: '当前密码不正确。' })
    const code = parsed.data.code.trim()
    let valid = false
    const secret = getTotpSecret(user)
    if (secret && /^\d{6}$/.test(code)) valid = verifyTotp(code, secret)
    if (!valid) {
      const normalized = normalizeRecoveryCode(code)
      if (/^[0-9A-F]{8}$/.test(normalized)) {
        const hashes = parseJson<string[]>(user.totpRecoveryCodesJson, [])
        for (const hash of hashes) {
          if (await verifyPassword(normalized, hash)) {
            valid = true
            await db.update(users).set({ totpRecoveryCodesJson: JSON.stringify(hashes.filter(item => item !== hash)), updatedAt: Date.now() }).where(eq(users.id, user.id))
            break
          }
        }
      }
    }
    if (!valid) return reply.code(400).send({ error: 'INVALID_CODE', message: '验证码或恢复码不正确。' })
    const now = Date.now()
    await db.update(users).set({
            totpSecretCiphertext: null,
            totpSecretIv: null,
            totpSecretTag: null,
            totpEnabled: false,
            totpVerifiedAt: null,
            totpRecoveryCodesJson: '[]',
            updatedAt: now,
          }).where(eq(users.id, user.id))
    await db.delete(sessions).where(eq(sessions.userId, user.id))
    const session = (await createSession(user.id, undefined, sessionMetadata(request)))
    setSessionCookie(reply, session.token, session.expiresAt)
    return { enabled: false }
  })

  app.post('/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ currentPassword: z.string().min(1, '请输入当前密码。'), newPassword: z.string().min(8, '新密码至少需要 8 位。').max(128) }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: parsed.error.issues[0]?.message })
    const user = (await db.$first(db.select().from(users).where(eq(users.id, request.auth.userId))))
    if (!user) return reply.code(404).send({ error: 'NOT_FOUND', message: '用户不存在。' })
    if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) return reply.code(401).send({ error: 'INVALID_PASSWORD', message: '当前密码不正确。' })
    const passwordHash = await hashPassword(parsed.data.newPassword)
    await db.update(users).set({ passwordHash, updatedAt: Date.now() }).where(eq(users.id, user.id))
    await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, request.auth.sessionId)))
    return { ok: true }
  })

  app.delete('/account', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ currentPassword: z.string().min(1), confirmation: z.literal('DELETE') }).safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: '请输入当前密码并填写 DELETE 确认。' })
    const user = (await db.$first(db.select().from(users).where(eq(users.id, request.auth.userId))))
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) return reply.code(401).send({ error: 'INVALID_PASSWORD', message: '当前密码不正确。' })
    if (request.auth.role === 'owner') {
      const memberCount = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, request.auth.workspaceId))))?.count ?? 0
      if (memberCount > 1) return reply.code(409).send({ error: 'WORKSPACE_HAS_MEMBERS', message: '请先移除其他成员，再删除所有者账户和工作区。' })
    }
    await db.delete(users).where(eq(users.id, request.auth.userId))
    clearSessionCookie(reply)
    clearChallengeCookie(reply)
    return reply.code(204).send()
  })
}
