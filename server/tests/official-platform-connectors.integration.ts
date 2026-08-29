import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { leadSourceConnections, outboundChannelConnections, users } from '../db/schema.js'
import { resolveLeadSourceAccessToken } from '../leads/provider-oauth.js'
import { buildWhatsappMessagePayload } from '../outbox/whatsapp-templates.js'
import { isWhatsappConversationOpen } from '../outbox/service.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  let ownerId = ''
  const originalFetch = globalThis.fetch
  try {
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: '平台连接管理员', email: `platform-${suffix}@integration.local`, password: 'Platform@2026' } })
    assert.equal(registered.statusCode, 201, registered.body)
    ownerId = registered.json().user.id
    const headers = { cookie: cookieValue(registered.headers['set-cookie']) }

    globalThis.fetch = (async (input, init) => {
      const url = new URL(String(input))
      const body = init?.body instanceof URLSearchParams ? init.body : new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
      if (url.hostname === 'www.linkedin.com' && url.pathname.endsWith('/accessToken')) {
        return body.get('grant_type') === 'refresh_token'
          ? json({ access_token: 'linkedin-refreshed-token', expires_in: 5_184_000, refresh_token: 'linkedin-refresh-token', refresh_token_expires_in: 31_536_000, scope: 'r_marketing_leadgen_automation' })
          : json({ access_token: 'linkedin-oauth-token', expires_in: 5_184_000, refresh_token: 'linkedin-refresh-token', refresh_token_expires_in: 31_536_000, scope: 'r_marketing_leadgen_automation' })
      }
      if (url.hostname === 'graph.facebook.com' && url.pathname.endsWith('/oauth/access_token')) {
        return url.searchParams.get('grant_type') === 'fb_exchange_token'
          ? json({ access_token: 'meta-long-lived-token', expires_in: 5_184_000 })
          : json({ access_token: 'meta-short-lived-token', expires_in: 3600 })
      }
      if (url.hostname === 'graph.facebook.com' && url.pathname.includes('/message_templates')) {
        return json({ data: [{ id: 'template-1', name: 'sondara_follow_up', language: 'en_US', status: 'APPROVED', category: 'UTILITY', quality_score: { score: 'GREEN' }, components: [{ type: 'BODY', text: 'Follow up: {{1}}' }] }] })
      }
      if (url.hostname === 'graph.facebook.com' && url.pathname.includes('/meta-lead-')) {
        return json({ id: url.pathname.split('/').at(-1), campaign_name: 'Industrial Growth', field_data: [{ name: 'company_name', values: ['Official Platform Buyer Ltd'] }, { name: 'full_name', values: ['Morgan Buyer'] }, { name: 'email', values: ['morgan@example.com'] }, { name: 'job_title', values: ['Procurement Director'] }] })
      }
      throw new Error(`Unexpected fetch ${url}`)
    }) as typeof fetch

    const linkedinCreate = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers, payload: { name: `LinkedIn OAuth ${suffix}`, provider: 'linkedin-lead-gen', clientId: 'linkedin-client', verificationSecret: 'linkedin-secret' } })
    assert.equal(linkedinCreate.statusCode, 201, linkedinCreate.body)
    const linkedinId = linkedinCreate.json().id as string
    const linkedinStart = await app.inject({ method: 'POST', url: `/api/lead-sources/connections/${linkedinId}/oauth/start`, headers })
    assert.equal(linkedinStart.statusCode, 200, linkedinStart.body)
    const linkedinAuthorization = new URL(linkedinStart.json().authorizationUrl)
    assert.equal(linkedinAuthorization.searchParams.get('scope'), 'r_marketing_leadgen_automation')
    const linkedinState = linkedinAuthorization.searchParams.get('state')!
    const linkedinCallback = await app.inject({ method: 'GET', url: `/api/lead-sources/oauth/linkedin-lead-gen/callback?state=${encodeURIComponent(linkedinState)}&code=linkedin-code` })
    assert.equal(linkedinCallback.statusCode, 302, linkedinCallback.body)
    assert.match(String(linkedinCallback.headers.location), /oauth=success/)
    const replay = await app.inject({ method: 'GET', url: `/api/lead-sources/oauth/linkedin-lead-gen/callback?state=${encodeURIComponent(linkedinState)}&code=replay` })
    assert.match(String(replay.headers.location), /oauth=invalid_state/)
    await db.update(leadSourceConnections).set({ accessTokenExpiresAt: Date.now() - 1 }).where(eq(leadSourceConnections.id, linkedinId))
    const expiredLinkedin = (await db.$first(db.select().from(leadSourceConnections).where(eq(leadSourceConnections.id, linkedinId))))!
    assert.equal(await resolveLeadSourceAccessToken(expiredLinkedin), 'linkedin-refreshed-token')

    const metaSecret = 'meta-app-secret'
    const metaCreate = await app.inject({ method: 'POST', url: '/api/lead-sources/connections', headers, payload: { name: `Meta OAuth ${suffix}`, provider: 'meta-lead-ads', clientId: 'meta-client', verificationSecret: metaSecret } })
    assert.equal(metaCreate.statusCode, 201, metaCreate.body)
    const metaId = metaCreate.json().id as string
    const metaStart = await app.inject({ method: 'POST', url: `/api/lead-sources/connections/${metaId}/oauth/start`, headers })
    const metaAuthorization = new URL(metaStart.json().authorizationUrl)
    assert.match(metaAuthorization.searchParams.get('scope') || '', /leads_retrieval/)
    const metaState = metaAuthorization.searchParams.get('state')!
    const metaCallback = await app.inject({ method: 'GET', url: `/api/lead-sources/oauth/meta-lead-ads/callback?state=${encodeURIComponent(metaState)}&code=meta-code` })
    assert.match(String(metaCallback.headers.location), /oauth=success/)
    const metaConnection = (await db.$first(db.select().from(leadSourceConnections).where(eq(leadSourceConnections.id, metaId))))!
    assert.equal(metaConnection.accessTokenEnding, 'OKEN')

    const metaWebhook = new URL(metaCreate.json().webhookUrl)
    const leadId = `meta-lead-${suffix}`
    const metaPayload = JSON.stringify({ object: 'page', entry: [{ id: 'page-1', changes: [{ field: 'leadgen', value: { leadgen_id: leadId, form_id: 'form-1' } }] }] })
    const signature = `sha256=${createHmac('sha256', metaSecret).update(metaPayload).digest('hex')}`
    const metaEvent = await app.inject({ method: 'POST', url: metaWebhook.pathname + metaWebhook.search, headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, payload: metaPayload })
    assert.equal(metaEvent.statusCode, 200, metaEvent.body)
    assert.equal(metaEvent.json().status, 'processed')

    const whatsappCreate = await app.inject({ method: 'POST', url: '/api/outbox/connections', headers, payload: { name: `WhatsApp ${suffix}`, provider: 'whatsapp-cloud', host: 'https://graph.facebook.com/v23.0', port: 443, secure: true, username: 'phone-number-id', password: 'whatsapp-token', fromName: 'Growth Team', fromEmail: 'growth@example.com', whatsappBusinessAccountId: 'business-account-id', whatsappDefaultTemplateName: 'sondara_follow_up', whatsappDefaultTemplateLanguage: 'en_US', imapEnabled: false, imapPort: 993, imapSecure: true, priority: 1, enabled: true } })
    assert.equal(whatsappCreate.statusCode, 201, whatsappCreate.body)
    const whatsappId = whatsappCreate.json().id as string
    const synced = await app.inject({ method: 'POST', url: `/api/outbox/connections/${whatsappId}/whatsapp/templates/sync`, headers })
    assert.equal(synced.statusCode, 200, synced.body)
    assert.equal(synced.json().items[0].status, 'APPROVED')
    const whatsappConnection = (await db.$first(db.select().from(outboundChannelConnections).where(eq(outboundChannelConnections.id, whatsappId))))!
    const message = buildWhatsappMessagePayload({ connection: whatsappConnection, to: '+1 (555) 010-2026', body: 'Your requested catalogue is ready.' }) as { type: string; template: { name: string; components: Array<{ parameters: Array<{ text: string }> }> } }
    assert.equal(message.type, 'template')
    assert.equal(message.template.name, 'sondara_follow_up')
    assert.equal(message.template.components[0].parameters[0].text, 'Your requested catalogue is ready.')
    const now = Date.now()
    assert.equal(isWhatsappConversationOpen(now - 23 * 60 * 60_000, now), true)
    assert.equal(isWhatsappConversationOpen(now - 25 * 60 * 60_000, now), false)

    console.log('Official platform connectors integration passed: LinkedIn OAuth and refresh, Meta OAuth and leadgen_id hydration, WhatsApp template sync/status and template payload verified.')
  } finally {
    globalThis.fetch = originalFetch
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    await app.close()
  }
}

run().catch(error => { console.error(error); process.exitCode = 1 })
