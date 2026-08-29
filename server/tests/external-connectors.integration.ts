import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { customers, externalConnectorConfigurations, externalConnectorRuns, users } from '../db/schema.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const originalFetch = globalThis.fetch
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  let ownerId = ''
  let otherId = ''
  try {
    const owner = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Connector Owner', email: `connector-owner-${suffix}@example.com`, password: 'Connector@2026' } })
    assert.equal(owner.statusCode, 201, owner.body)
    ownerId = owner.json().user.id
    const headers = { cookie: cookieValue(owner.headers['set-cookie']) }

    const catalog = await app.inject({ method: 'GET', url: '/api/integrations/catalog', headers })
    assert.equal(catalog.statusCode, 200, catalog.body)
    assert.equal(catalog.json().items.length, 7)
    const companySlot = catalog.json().items.find((item: { key: string }) => item.key === 'company-contact-database')
    assert.equal(companySlot.configuration, null)
    assert.ok(companySlot.fields.some((field: { key: string; secret?: boolean }) => field.key === 'apiKey' && field.secret))

    const missingCredentials = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/configuration', headers, payload: { settings: { providerKey: 'Apollo', providerName: 'Example Data', endpoint: 'https://api.apollo.io/v1' }, credentials: {} } })
    assert.equal(missingCredentials.statusCode, 400, missingCredentials.body)
    const unsupportedField = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/configuration', headers, payload: { settings: { providerKey: 'Apollo', providerName: 'Example Data', endpoint: 'https://api.apollo.io/v1', unsupported: 'no' }, credentials: { apiKey: 'connector-key-value' } } })
    assert.equal(unsupportedField.statusCode, 400, unsupportedField.body)

    const created = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/configuration', headers, payload: { name: '主企业数据服务', enabled: true, settings: { providerKey: 'Apollo', providerName: 'Example Data', endpoint: 'https://api.apollo.io/v1', accountId: 'workspace-100' }, credentials: { apiKey: 'connector-key-value' } } })
    assert.equal(created.statusCode, 200, created.body)
    assert.equal(created.json().hasCredentials, true)
    assert.equal(created.json().credentialEndings.apiKey, 'ALUE')
    assert.ok(!('credentials' in created.json()))
    const stored = await db.$first(db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, created.json().id)))
    assert.ok(stored?.credentialsCiphertext)
    assert.ok(!stored?.credentialsCiphertext?.includes('connector-key-value'))

    const updated = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/configuration', headers, payload: { name: '企业数据服务（更新）', enabled: true, settings: { providerKey: 'Apollo', providerName: 'Example Data Updated', endpoint: 'https://api.apollo.io/v2' }, credentials: {} } })
    assert.equal(updated.statusCode, 200, updated.body)
    assert.equal(updated.json().credentialEndings.apiKey, 'ALUE')
    assert.equal(updated.json().settings.endpoint, 'https://api.apollo.io/v2')

    const validated = await app.inject({ method: 'POST', url: '/api/integrations/catalog/company-contact-database/validate', headers })
    assert.equal(validated.statusCode, 200, validated.body)
    assert.equal(validated.json().networkRequest, false)
    assert.equal(validated.json().status, 'validated')

    globalThis.fetch = async () => new Response(JSON.stringify({ people: [{ id: 'prospect-1', first_name: 'Amina', last_name: 'Buyer', title: 'Procurement Director', email: 'amina@example.com', organization: { name: 'Connector Runtime Industries', country: 'AE', industry: 'Industrial' } }] }), { status: 200 })
    const synced = await app.inject({ method: 'POST', url: '/api/integrations/catalog/company-contact-database/run', headers, payload: { query: 'industrial buyer UAE', limit: 10, importRecords: true } })
    assert.equal(synced.statusCode, 200, synced.body)
    assert.equal(synced.json().fetchedCount, 1)
    assert.equal(synced.json().createdCount, 1)
    assert.ok(await db.$first(db.select().from(customers).where(eq(customers.company, 'Connector Runtime Industries'))))
    const runs = await app.inject({ method: 'GET', url: '/api/integrations/catalog/company-contact-database/runs', headers })
    assert.equal(runs.statusCode, 200, runs.body); assert.equal(runs.json().items[0].status, 'completed')
    assert.ok(await db.$first(db.select().from(externalConnectorRuns).where(eq(externalConnectorRuns.id, synced.json().id))))

    const other = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Other Connector Owner', email: `connector-other-${suffix}@example.com`, password: 'Connector@2026' } })
    assert.equal(other.statusCode, 201, other.body)
    otherId = other.json().user.id
    const otherHeaders = { cookie: cookieValue(other.headers['set-cookie']) }
    const isolated = await app.inject({ method: 'GET', url: '/api/integrations/catalog', headers: otherHeaders })
    assert.equal(isolated.statusCode, 200, isolated.body)
    assert.ok(isolated.json().items.every((item: { configuration: unknown }) => item.configuration === null))

    const removed = await app.inject({ method: 'DELETE', url: '/api/integrations/catalog/company-contact-database/configuration', headers })
    assert.equal(removed.statusCode, 204, removed.body)
    assert.equal(await db.$first(db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, created.json().id))), undefined)
    console.log('External connector catalog integration passed: seven P2 slots, encrypted credential persistence, field allowlists, non-network validation, update preservation and workspace isolation verified.')
  } finally {
    globalThis.fetch = originalFetch
    if (ownerId) await db.delete(users).where(eq(users.id, ownerId))
    if (otherId) await db.delete(users).where(eq(users.id, otherId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
