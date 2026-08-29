import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { customers, deals, externalConnectorConfigurations, externalObjectMappings, tasks, users } from '../db/schema.js'
import { syncHubspotCrmObjects } from '../integrations/hubspot-crm-sync.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const originalFetch = globalThis.fetch; const app = await buildApp(); let userId = ''; const writeCalls: string[] = []
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'HubSpot Owner', email: `hubspot-${suffix}@example.com`, password: 'HubSpot@2026' } })
    assert.equal(registered.statusCode, 201, registered.body); userId = registered.json().user.id
    const headers = { cookie: cookieValue(registered.headers['set-cookie']) }
    const configured = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/crm-sync/configuration', headers, payload: { settings: { providerKey: 'HubSpot', providerName: 'HubSpot', endpoint: 'https://api.hubapi.com/crm/v3/objects/contacts', syncDirection: '仅导入到 Sondara' }, credentials: { accessToken: 'private-app-token' } } })
    assert.equal(configured.statusCode, 200, configured.body)
    const configuration = await db.$first(db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, configured.json().id))); assert.ok(configuration)
    const remoteTime = new Date(Date.now() - 60_000).toISOString()
    globalThis.fetch = async (input, init) => {
      const url = String(input); const method = init?.method || 'GET'
      if (method !== 'GET') { writeCalls.push(`${method} ${url}`); return new Response(JSON.stringify({ id: url.split('/').pop() || 'created-id', updatedAt: new Date().toISOString() }), { status: 200 }) }
      if (url.includes('/companies')) return new Response(JSON.stringify({ results: [{ id: 'hs-company-1', updatedAt: remoteTime, properties: { name: 'HubSpot Synced Company', domain: 'synced.example.com', industry: 'Manufacturing', country: 'DE', numberofemployees: '250' } }] }), { status: 200 })
      if (url.includes('/deals')) return new Response(JSON.stringify({ results: [{ id: 'hs-deal-1', updatedAt: remoteTime, properties: { dealname: 'Plant project', amount: '125000', dealstage: 'presentationscheduled', closedate: new Date(Date.now() + 86_400_000).toISOString() }, associations: { companies: { results: [{ id: 'hs-company-1' }] } } }] }), { status: 200 })
      if (url.includes('/tasks')) return new Response(JSON.stringify({ results: [{ id: 'hs-task-1', updatedAt: remoteTime, properties: { hs_task_subject: 'Prepare proposal', hs_task_body: 'Send technical offer', hs_task_status: 'NOT_STARTED', hs_task_priority: 'HIGH', hs_timestamp: new Date(Date.now() + 43_200_000).toISOString() }, associations: { companies: { results: [{ id: 'hs-company-1' }] } } }] }), { status: 200 })
      return new Response(JSON.stringify({ results: [] }), { status: 200 })
    }
    const imported = await syncHubspotCrmObjects(configuration, { endpoint: 'https://api.hubapi.com/crm/v3/objects/contacts', syncDirection: '仅导入到 Sondara' }, { accessToken: 'private-app-token' }, 25)
    assert.equal(imported.imported, 3)
    const customer = await db.$first(db.select().from(customers).where(eq(customers.company, 'HubSpot Synced Company'))); assert.ok(customer)
    const deal = await db.$first(db.select().from(deals).where(eq(deals.customerId, customer.id))); assert.equal(deal?.valueAmount, 125000); assert.equal(deal?.stage, '方案评估')
    const task = await db.$first(db.select().from(tasks).where(eq(tasks.customerId, customer.id))); assert.equal(task?.priority, '高'); assert.equal(task?.status, 'open')
    assert.equal((await db.select().from(externalObjectMappings).where(eq(externalObjectMappings.configurationId, configuration.id))).length, 3)

    const localUpdatedAt = Date.now() + 5_000
    await db.update(customers).set({ region: '本地人工修正', updatedAt: localUpdatedAt }).where(eq(customers.id, customer.id))
    const conflict = await syncHubspotCrmObjects(configuration, { endpoint: 'https://api.hubapi.com/crm/v3/objects/contacts', syncDirection: '仅导入到 Sondara' }, { accessToken: 'private-app-token' }, 25)
    assert.ok(conflict.skipped >= 1)
    assert.equal((await db.$first(db.select().from(customers).where(eq(customers.id, customer.id))))?.region, '本地人工修正')

    const exported = await syncHubspotCrmObjects(configuration, { endpoint: 'https://api.hubapi.com/crm/v3/objects/contacts', syncDirection: '仅导出到 CRM' }, { accessToken: 'private-app-token' }, 25)
    assert.equal(exported.exported, 3)
    assert.ok(writeCalls.some(call => call.startsWith('PATCH') && call.includes('/companies/hs-company-1')))
    assert.ok(writeCalls.some(call => call.startsWith('PATCH') && call.includes('/deals/hs-deal-1')))
    assert.ok(writeCalls.some(call => call.startsWith('PATCH') && call.includes('/tasks/hs-task-1')))
    assert.ok(writeCalls.filter(call => call.includes('/associations/default/companies/hs-company-1')).length >= 2)
    console.log('HubSpot CRM sync integration passed: companies, deals, tasks, mappings, conflict protection, bidirectional writes and default associations verified.')
  } finally {
    globalThis.fetch = originalFetch
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
