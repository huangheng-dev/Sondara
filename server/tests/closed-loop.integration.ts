import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { passwordResetTokens, users } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { hashSessionToken } from '../lib/session.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerEmail = `closed-owner-${suffix}@integration.local`
  const memberEmail = `closed-viewer-${suffix}@integration.local`
  let ownerId = ''
  let memberId = ''
  try {
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', headers: { 'user-agent': 'Sondara Integration Browser' }, payload: { displayName: '闭环所有者', email: ownerEmail, password: 'ClosedLoop@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    ownerId = register.json().user.id
    let ownerCookie = cookieValue(register.headers['set-cookie'])
    assert.ok(ownerCookie)

    const profile = await app.inject({ method: 'PATCH', url: '/api/auth/profile', headers: { cookie: ownerCookie }, payload: { displayName: '闭环负责人', email: ownerEmail, locale: 'zh-CN', timezone: 'Asia/Shanghai', currency: 'CNY', businessName: '闭环测试工作区' } })
    assert.equal(profile.statusCode, 200, profile.body)
    assert.equal(profile.json().workspace.name, '闭环测试工作区')

    const sessions = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: { cookie: ownerCookie } })
    assert.equal(sessions.statusCode, 200, sessions.body)
    assert.equal(sessions.json().items.length, 1)
    assert.equal(sessions.json().items[0].current, true)
    assert.match(sessions.json().items[0].userAgent, /Integration Browser/)

    const member = await app.inject({ method: 'POST', url: '/api/admin/members', headers: { cookie: ownerCookie }, payload: { displayName: '只读测试员', email: memberEmail, password: 'ViewerPass@2026', role: 'viewer' } })
    assert.equal(member.statusCode, 201, member.body)
    memberId = member.json().id
    assert.equal(member.json().role, 'viewer')

    const viewerLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: memberEmail, password: 'ViewerPass@2026', remember: false } })
    assert.equal(viewerLogin.statusCode, 200, viewerLogin.body)
    const viewerCookie = cookieValue(viewerLogin.headers['set-cookie'])
    const viewerRead = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: viewerCookie } })
    assert.equal(viewerRead.statusCode, 200, viewerRead.body)
    const viewerWrite = await app.inject({ method: 'POST', url: '/api/customers', headers: { cookie: viewerCookie }, payload: { company: '不应创建的客户' } })
    assert.equal(viewerWrite.statusCode, 403, viewerWrite.body)
    const viewerAdmin = await app.inject({ method: 'GET', url: '/api/admin/members', headers: { cookie: viewerCookie } })
    assert.equal(viewerAdmin.statusCode, 403, viewerAdmin.body)

    const customer = await app.inject({ method: 'POST', url: '/api/customers', headers: { cookie: ownerCookie }, payload: { company: '闭环客户有限公司', region: '德国', industry: '工业设备', score: 93, ownerUserId: memberId } })
    assert.equal(customer.statusCode, 201, customer.body)
    const customerId = customer.json().id
    const tags = await app.inject({ method: 'POST', url: '/api/customers/tags/bulk', headers: { cookie: ownerCookie }, payload: { customerIds: [customerId], name: '本周重点', color: 'orange' } })
    assert.equal(tags.statusCode, 201, tags.body)
    const contact = await app.inject({ method: 'POST', url: `/api/customers/${customerId}/contacts`, headers: { cookie: ownerCookie }, payload: { name: 'Anna Meyer', jobTitle: '采购经理', email: 'anna@example.com', primaryChannel: '邮件' } })
    assert.equal(contact.statusCode, 201, contact.body)
    const contacts = await app.inject({ method: 'GET', url: `/api/customers/${customerId}/contacts`, headers: { cookie: ownerCookie } })
    assert.equal(contacts.statusCode, 200, contacts.body)
    assert.equal(contacts.json().items.length, 1)
    const customerList = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: ownerCookie } })
    const persistedCustomer = customerList.json().items.find((item: { id: string }) => item.id === customerId)
    assert.equal(persistedCustomer.ownerName, '只读测试员')
    assert.equal(persistedCustomer.tags[0].name, '本周重点')
    assert.equal(persistedCustomer.validContacts, 1)

    const policy = await app.inject({ method: 'PATCH', url: '/api/ai/policy', headers: { cookie: ownerCookie }, payload: { rotationStrategy: 'round-robin', retryCount: 1, retryBackoff: 'fixed', retryDelayMs: 3000, cooldownMs: 900000, failoverEnabled: false } })
    assert.equal(policy.statusCode, 200, policy.body)
    const policyRead = await app.inject({ method: 'GET', url: '/api/ai/policy', headers: { cookie: ownerCookie } })
    assert.equal(policyRead.statusCode, 200, policyRead.body)
    assert.equal(policyRead.json().rotationStrategy, 'round-robin')
    assert.equal(policyRead.json().failoverEnabled, false)
    const service = await app.inject({ method: 'POST', url: '/api/ai/services', headers: { cookie: ownerCookie }, payload: { name: `闭环 AI ${suffix}`, provider: 'openai-compatible', endpoint: 'https://ai.example.com/v1', model: 'closed-loop-model' } })
    assert.equal(service.statusCode, 201, service.body)
    const key = await app.inject({ method: 'POST', url: `/api/ai/services/${service.json().id}/keys`, headers: { cookie: ownerCookie }, payload: { name: '生产密钥', secret: 'sk-closed-loop-secret' } })
    assert.equal(key.statusCode, 201, key.body)
    const keyDelete = await app.inject({ method: 'DELETE', url: `/api/ai/keys/${key.json().id}`, headers: { cookie: ownerCookie } })
    assert.equal(keyDelete.statusCode, 204, keyDelete.body)

    const audit = await app.inject({ method: 'GET', url: '/api/admin/audit-logs', headers: { cookie: ownerCookie } })
    assert.equal(audit.statusCode, 200, audit.body)
    assert.ok(audit.json().items.some((item: { action: string }) => item.action === 'member.created'))
    assert.ok(audit.json().items.some((item: { action: string }) => item.action === 'customer.tags_added'))
    assert.ok(audit.json().items.some((item: { action: string }) => item.action === 'ai.policy.updated'))

    const resetToken = `closed-loop-reset-token-${suffix}`
    await db.insert(passwordResetTokens).values({ id: createId('prt'), userId: ownerId, tokenHash: hashSessionToken(resetToken), expiresAt: Date.now() + 60_000, createdAt: Date.now() })
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: resetToken, newPassword: 'ClosedLoopNew@2026' } })
    assert.equal(reset.statusCode, 200, reset.body)
    const revoked = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie: ownerCookie } })
    assert.equal(revoked.statusCode, 401, revoked.body)
    const loginNewPassword = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: ownerEmail, password: 'ClosedLoopNew@2026', remember: true } })
    assert.equal(loginNewPassword.statusCode, 200, loginNewPassword.body)
    ownerCookie = cookieValue(loginNewPassword.headers['set-cookie'])
    assert.ok(ownerCookie)

    console.log('Closed-loop integration passed: RBAC, admin audit, profile/sessions, customer ownership/tags/contacts, AI policy/key lifecycle and password reset verified.')
  } finally {
    if (memberId) await db.delete(users).where(eq(users.id, memberId))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
