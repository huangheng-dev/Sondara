import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { customers, users, workspaceMembers } from '../db/schema.js'
import { executeExternalConnector } from '../integrations/external-connector-runtime.js'
import { createId } from '../lib/ids.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('apollo.io')) return new Response(JSON.stringify({ people: [{ id: 'apollo-1', first_name: 'Ada', last_name: 'Lovelace', title: 'Director', email: 'ada@example.com', organization: { name: 'Analytical Engines', country: 'GB', industry: 'Engineering' } }] }), { status: 200 })
    if (url.includes('hunter.io')) return new Response(JSON.stringify({ data: { status: 'valid', email: 'buyer@example.com' } }), { status: 200 })
    if (url.includes('zerobounce.net')) return new Response(JSON.stringify({ status: 'valid', address: 'buyer@example.com' }), { status: 200 })
    if (url.includes('neverbounce.com')) return new Response(JSON.stringify({ result: 'invalid', flags: ['bad_syntax'] }), { status: 200 })
    if (url.includes('twilio.com')) { assert.match(String((init?.headers as Record<string, string>).authorization), /^Basic /); return new Response(JSON.stringify({ phone_number: '+442071838750', country_code: 'GB', valid: true, validation_errors: null }), { status: 200 }) }
    if (url.includes('hubspot.com/oauth/')) return new Response(JSON.stringify({ access_token: 'refreshed-access-token', expires_in: 1800 }), { status: 200 })
    if (url.includes('hubapi.com')) return new Response(JSON.stringify({ results: [{ id: 'hub-1', properties: { email: 'crm@example.com', firstname: 'CRM', lastname: 'Buyer', jobtitle: 'Manager', company: 'CRM Company', country: 'US' } }], paging: { next: { after: 'next-1' } } }), { status: 200 })
    return new Response(JSON.stringify({ data: { items: [{ id: 'generic-1', company_name: 'Generic Industries', country: 'DE', industry: 'Manufacturing', website: 'generic.example' }] }, next_cursor: 'cursor-2' }), { status: 200 })
  }
  let app: Awaited<ReturnType<typeof buildApp>> | undefined
  let userId = ''
  try {
    const apollo = await executeExternalConnector({ connectorKey: 'company-contact-database', settings: { endpoint: 'https://api.apollo.io/api/v1/mixed_people/api_search' }, credentials: { apiKey: 'key' }, query: 'industrial buyers', limit: 10 })
    assert.equal(apollo.records[0]?.company, 'Analytical Engines')
    const hunter = await executeExternalConnector({ connectorKey: 'email-verification', settings: { endpoint: 'https://api.hunter.io/v2/email-verifier' }, credentials: { apiKey: 'key' }, values: [{ id: 'contact-1', value: 'buyer@example.com' }], limit: 1 })
    assert.equal(hunter.records[0]?.valid, true)
    const zeroBounce = await executeExternalConnector({ connectorKey: 'email-verification', settings: { providerKey: 'ZeroBounce', endpoint: 'https://api.zerobounce.net/v2/validate' }, credentials: { apiKey: 'key' }, values: [{ id: 'contact-zb', value: 'buyer@example.com' }], limit: 1 })
    assert.equal(zeroBounce.records[0]?.valid, true)
    const neverBounce = await executeExternalConnector({ connectorKey: 'email-verification', settings: { providerKey: 'NeverBounce', endpoint: 'https://api.neverbounce.com/v4/single/check' }, credentials: { apiKey: 'key' }, values: [{ id: 'contact-nb', value: 'invalid@example.com' }], limit: 1 })
    assert.equal(neverBounce.records[0]?.valid, false)
    const twilio = await executeExternalConnector({ connectorKey: 'phone-verification', settings: { endpoint: 'https://lookups.twilio.com/v2/PhoneNumbers', accountSid: 'AC123' }, credentials: { authToken: 'secret' }, values: [{ id: 'contact-2', value: '+442071838750' }], limit: 1 })
    assert.equal(twilio.records[0]?.phone, '+442071838750')
    const hubspot = await executeExternalConnector({ connectorKey: 'crm-sync', settings: { endpoint: 'https://api.hubapi.com/crm/v3/objects/contacts' }, credentials: { accessToken: 'token' }, limit: 10 })
    assert.equal(hubspot.records[0]?.company, 'CRM Company'); assert.equal(hubspot.cursor, 'next-1')
    const oauthHubspot = await executeExternalConnector({ connectorKey: 'crm-sync', settings: { endpoint: 'https://api.hubapi.com/crm/v3/objects/contacts', clientId: 'client-id', syncDirection: '仅导入到 Sondara' }, credentials: { accessToken: 'refresh-token', clientSecret: 'client-secret' }, limit: 10 })
    assert.equal(oauthHubspot.records[0]?.company, 'CRM Company')
    const exported = await executeExternalConnector({ connectorKey: 'crm-sync', settings: { endpoint: 'https://api.hubapi.com/crm/v3/objects/contacts', syncDirection: '仅导出到 CRM' }, credentials: { accessToken: 'token' }, exportRecords: [{ externalId: 'local-1', company: 'Local Company', name: 'Local Buyer', email: 'local@example.com' }], limit: 10 })
    assert.equal(exported.exportedCount, 1); assert.equal(exported.records.length, 0)
    const generic = await executeExternalConnector({ connectorKey: 'vertical-industry-database', settings: { endpoint: 'https://api.github.com/records', itemsPath: 'data.items', fieldMapping: '{"id":"id","company":"company_name","region":"country"}' }, credentials: { apiKey: 'key' }, query: 'supplier', limit: 10 })
    assert.equal(generic.records[0]?.company, 'Generic Industries'); assert.equal(generic.cursor, 'cursor-2')

    app = await buildApp()
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Adapter Owner', email: `adapter-${suffix}@example.com`, password: 'Adapter@2026' } })
    assert.equal(registered.statusCode, 201, registered.body); userId = registered.json().user.id
    const headers = { cookie: cookieValue(registered.headers['set-cookie']) }
    const member = await db.$first(db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, userId))); assert.ok(member)
    const customerId = createId('cus'); const now = Date.now()
    await db.insert(customers).values({ id: customerId, workspaceId: member.workspaceId, company: 'Visitor Company', createdAt: now, updatedAt: now })
    const configured = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/website-visitor-identification/configuration', headers, payload: { settings: { providerKey: 'Generic Webhook', providerName: 'Visitor Provider' }, credentials: { webhookSecret: 'visitor-secret' } } })
    assert.equal(configured.statusCode, 200, configured.body)
    const raw = JSON.stringify({ event_id: 'visit-1', company: 'Visitor Company', page_url: 'https://example.com/pricing' })
    const signature = `sha256=${createHmac('sha256', 'visitor-secret').update(raw).digest('hex')}`
    const webhook = await app.inject({ method: 'POST', url: configured.json().webhookPath, headers: { 'content-type': 'application/json', 'x-sondara-signature': signature }, payload: raw })
    assert.equal(webhook.statusCode, 200, webhook.body); assert.equal(webhook.json().matched, true)
    const duplicate = await app.inject({ method: 'POST', url: configured.json().webhookPath, headers: { 'content-type': 'application/json', 'x-sondara-signature': signature }, payload: raw })
    assert.equal(duplicate.json().duplicate, true)
    console.log('External connector adapters integration passed: Apollo, Hunter, ZeroBounce, NeverBounce, Twilio, HubSpot, Generic REST and signed visitor webhook verified with mocked official responses.')
  } finally {
    globalThis.fetch = originalFetch
    if (userId) await db.delete(users).where(eq(users.id, userId))
    if (app) await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
