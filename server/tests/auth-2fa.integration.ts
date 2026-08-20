import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { authChallenges, users } from '../db/schema.js'
import { generateTotp } from '../lib/totp.js'

const cookieHeader = (setCookie: string | string[] | undefined, name: string) => {
  const value = Array.isArray(setCookie) ? setCookie.join(';') : setCookie ?? ''
  const match = value.match(new RegExp(`${name}=([^;]+)`))
  return match ? `${name}=${match[1]}` : ''
}

const run = async () => {
  const app = await buildApp()
  const email = `2fa-${Date.now()}@integration.local`
  let userId = ''
  try {
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: '双重验证测试', email, password: 'TwoFactor@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const cookie = cookieHeader(register.headers['set-cookie'], 'sondara_session')

    const before = await app.inject({ method: 'GET', url: '/api/auth/2fa/status', headers: { cookie } })
    assert.equal(before.statusCode, 200, before.body)
    assert.equal(before.json().enabled, false)

    const setup = await app.inject({ method: 'POST', url: '/api/auth/2fa/setup', headers: { cookie } })
    assert.equal(setup.statusCode, 200, setup.body)
    assert.ok(setup.json().secret)
    assert.equal(setup.json().accountName, email)
    assert.match(setup.json().otpauth, /otpauth:\/\/totp\/Sondara:/)
    assert.match(setup.json().otpauth, new RegExp(`secret=${setup.json().secret}`))
    assert.match(setup.json().otpauth, new RegExp(`label=${encodeURIComponent(email)}|Sondara:${encodeURIComponent(email)}`))
    assert.match(setup.json().otpauth, /issuer=Sondara&algorithm=SHA1&digits=6&period=30/)

    const invalid = await app.inject({ method: 'POST', url: '/api/auth/2fa/enable', headers: { cookie }, payload: { currentPassword: 'TwoFactor@2026', secret: setup.json().secret, code: '000000' } })
    assert.equal(invalid.statusCode, 400, invalid.body)

    const validCode = generateTotp(setup.json().secret)
    const enabled = await app.inject({ method: 'POST', url: '/api/auth/2fa/enable', headers: { cookie }, payload: { currentPassword: 'TwoFactor@2026', secret: setup.json().secret, code: validCode } })
    assert.equal(enabled.statusCode, 201, enabled.body)
    assert.equal(enabled.json().enabled, true)
    assert.equal(enabled.json().recoveryCodes.length, 8)

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'TwoFactor@2026', remember: true } })
    assert.equal(login.statusCode, 202, login.body)
    assert.equal(login.json().twoFactorRequired, true)
    const challengeCookie = cookieHeader(login.headers['set-cookie'], 'sondara_2fa')
    assert.ok(challengeCookie)

    const wrong = await app.inject({ method: 'POST', url: '/api/auth/2fa/verify', headers: { cookie: challengeCookie }, payload: { code: '999999' } })
    assert.equal(wrong.statusCode, 401, wrong.body)

    const verified = await app.inject({ method: 'POST', url: '/api/auth/2fa/verify', headers: { cookie: challengeCookie }, payload: { code: generateTotp(setup.json().secret) } })
    assert.equal(verified.statusCode, 201, verified.body)
    assert.equal(verified.json().user.email, email)
    assert.equal((await db.select().from(authChallenges).where(eq(authChallenges.userId, userId))).length, 0)

    const recoveryLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'TwoFactor@2026', remember: true } })
    const recoveryCookie = cookieHeader(recoveryLogin.headers['set-cookie'], 'sondara_2fa')
    const recoveryCode = enabled.json().recoveryCodes[0]
    const recoveryVerified = await app.inject({ method: 'POST', url: '/api/auth/2fa/verify', headers: { cookie: recoveryCookie }, payload: { code: recoveryCode } })
    assert.equal(recoveryVerified.statusCode, 201, recoveryVerified.body)
    assert.equal(recoveryVerified.json().usedRecovery, true)

    const disable = await app.inject({ method: 'POST', url: '/api/auth/2fa/disable', headers: { cookie }, payload: { currentPassword: 'TwoFactor@2026', code: generateTotp(setup.json().secret) } })
    assert.equal(disable.statusCode, 200, disable.body)
    assert.equal(disable.json().enabled, false)
    const directLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'TwoFactor@2026', remember: true } })
    assert.equal(directLogin.statusCode, 200, directLogin.body)
    assert.ok(directLogin.json().workspace)

    console.log('Auth 2FA integration passed: setup, TOTP, recovery, challenge login and disable verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
