import assert from 'node:assert/strict'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { leadSourceConnections, leadSourceEvents, users } from '../db/schema.js'
import { eq } from 'drizzle-orm'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerEmail = `lead-owner-${suffix}@sondara.local`
  const memberEmail = `lead-member-${suffix}@sondara.local`
  let ownerId = ''
  let memberId = ''
  const connectionIds: string[] = []
  try {
    const owner = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: '线索负责人', email: ownerEmail, password: 'LeadOwner@2026' } })
    assert.equal(owner.statusCode, 201, owner.body)
    ownerId = owner.json().user.id
    const ownerHeaders = { cookie: cookieValue(owner.headers['set-cookie']) }

    const member = await app.inject({ method: 'POST', url: '/api/admin/members', headers: ownerHeaders, payload: { displayName: '线索成员', email: memberEmail, password: 'LeadMember@2026', role: 'member' } })
    assert.equal(member.statusCode, 201, member.body)
    memberId = member.json().id
    const memberLogin = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: memberEmail, password: 'LeadMember@2026', remember: true } })
    assert.equal(memberLogin.statusCode, 200, memberLogin.body)
    const memberHeaders = { cookie: cookieValue(memberLogin.headers['set-cookie']) }

    const forbidden = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers: memberHeaders, payload: { name: '成员不能创建', provider: 'meta-lead-ads' } })
    assert.equal(forbidden.statusCode, 403, forbidden.body)

    const invalid = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers: ownerHeaders, payload: { name: 'x', provider: 'unknown' } })
    assert.equal(invalid.statusCode, 400, invalid.body)

    const created = await app.inject({
      method: 'POST',
      url: '/api/lead-sources/connections',
      headers: ownerHeaders,
      payload: { name: `Meta Lead Ads ${suffix}`, provider: 'meta-lead-ads', accountRef: 'act-123', accessToken: 'meta-secret-token-value' },
    })
    assert.equal(created.statusCode, 201, created.body)
    const connection = created.json()
    connectionIds.push(connection.id)
    assert.equal(connection.hasAccessToken, true)
    assert.equal(connection.accessTokenEnding, 'ALUE')
    assert.ok(!('webhookTokenHash' in connection))
    assert.ok(!('accessTokenCiphertext' in connection))
    const webhookUrl = new URL(connection.webhookUrl)
    const token = webhookUrl.searchParams.get('token')
    assert.ok(token)

    const missingToken = await app.inject({ method: 'POST', url: webhookUrl.pathname, payload: { leadgen_id: 'lead-missing-token' } })
    assert.equal(missingToken.statusCode, 403, missingToken.body)
    const badToken = await app.inject({ method: 'POST', url: `${webhookUrl.pathname}?token=wrong`, payload: { leadgen_id: 'lead-bad-token' } })
    assert.equal(badToken.statusCode, 403, badToken.body)

    const challenge = await app.inject({ method: 'GET', url: `${webhookUrl.pathname}?token=${encodeURIComponent(token!)}&hub.challenge=CHALLENGE_OK` })
    assert.equal(challenge.statusCode, 200, challenge.body)
    assert.equal(challenge.body, 'CHALLENGE_OK')

    const event = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { leadgen_id: 'lead-001', form_id: 'form-001', entry: [{ changes: [{ field: 'leadgen' }] }] } })
    assert.equal(event.statusCode, 200, event.body)
    assert.equal(event.json().accepted, true)

    const duplicate = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { leadgen_id: 'lead-001', form_id: 'form-001' } })
    assert.equal(duplicate.statusCode, 200, duplicate.body)
    assert.equal(duplicate.json().duplicate, true)

    const hashedEvent = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { changed_fields: ['leadgen'], entry: [{ id: 'entry-hash' }], time: 1234567890 } })
    assert.equal(hashedEvent.statusCode, 200, hashedEvent.body)
    assert.equal(hashedEvent.json().accepted, true)

    const events = await app.inject({ method: 'GET', url: '/api/lead-sources/events', headers: ownerHeaders })
    assert.equal(events.statusCode, 200, events.body)
    assert.equal(events.json().items.length, 2)
    assert.ok(events.json().items.some((item: { providerEventId: string }) => item.providerEventId === 'lead-001'))

    const rotated = await app.inject({ method: 'POST', url: `/api/lead-sources/connections/${connection.id}/regenerate-webhook`, headers: ownerHeaders })
    assert.equal(rotated.statusCode, 200, rotated.body)
    const rotatedUrl = new URL(rotated.json().webhookUrl)
    const rotatedToken = rotatedUrl.searchParams.get('token')
    assert.ok(rotatedToken)
    assert.notEqual(rotatedToken, token)
    const oldTokenAfterRotation = await app.inject({ method: 'POST', url: webhookUrl.pathname + webhookUrl.search, payload: { leadgen_id: 'lead-old-token' } })
    assert.equal(oldTokenAfterRotation.statusCode, 403, oldTokenAfterRotation.body)
    const newTokenEvent = await app.inject({ method: 'POST', url: rotatedUrl.pathname + rotatedUrl.search, payload: { id: 'lead-rotated-token' } })
    assert.equal(newTokenEvent.statusCode, 200, newTokenEvent.body)
    assert.equal(newTokenEvent.json().accepted, true)

    console.log('Lead sources integration passed: connection permissions, token redaction, webhook verification, event idempotency, hash fallback and token rotation verified.')
  } finally {
    if (connectionIds.length) await db.delete(leadSourceEvents).where(eq(leadSourceEvents.connectionId, connectionIds[0]))
    for (const id of connectionIds) await db.delete(leadSourceConnections).where(eq(leadSourceConnections.id, id))
    if (memberId) await db.delete(users).where(eq(users.id, memberId))
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
