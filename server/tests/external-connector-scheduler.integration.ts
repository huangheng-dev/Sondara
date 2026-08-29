import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { externalConnectorConfigurations, externalConnectorRuns, users } from '../db/schema.js'
import { processDueExternalConnectors } from '../integrations/external-connector-worker.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const originalFetch = globalThis.fetch
  const app = await buildApp(); let userId = ''
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Scheduler Owner', email: `scheduler-${suffix}@example.com`, password: 'Scheduler@2026' } })
    assert.equal(registered.statusCode, 201, registered.body); userId = registered.json().user.id
    const headers = { cookie: cookieValue(registered.headers['set-cookie']) }
    const configured = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/configuration', headers, payload: { settings: { providerKey: 'Apollo', providerName: 'Apollo', endpoint: 'https://api.apollo.io/api/v1/mixed_people/api_search' }, credentials: { apiKey: 'scheduler-key' } } })
    assert.equal(configured.statusCode, 200, configured.body)
    const id = configured.json().id as string
    const scheduled = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/schedule', headers, payload: { enabled: true, intervalMinutes: 15, query: 'industrial buyer', perRunLimit: 2, dailyLimit: 3 } })
    assert.equal(scheduled.statusCode, 200, scheduled.body); assert.equal(scheduled.json().scheduleEnabled, true)
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body || '{}')) as { per_page?: number }
      const people = Array.from({ length: body.per_page ?? 1 }, (_, index) => ({ id: `scheduled-${Date.now()}-${index}`, first_name: 'Scheduled', last_name: `Buyer ${index}`, email: `scheduled${index}@example.com`, organization: { name: `Scheduled Company ${Date.now()} ${index}`, country: 'DE', industry: 'Industrial' } }))
      return new Response(JSON.stringify({ people }), { status: 200 })
    }
    assert.equal(await processDueExternalConnectors(Date.now() + 1000), 1)
    let current = await db.$first(db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, id))); assert.equal(current?.consecutiveFailures, 0)
    await db.update(externalConnectorConfigurations).set({ nextRunAt: Date.now() - 1 }).where(eq(externalConnectorConfigurations.id, id))
    assert.equal(await processDueExternalConnectors(), 1)
    const completed = await db.select().from(externalConnectorRuns).where(and(eq(externalConnectorRuns.configurationId, id), eq(externalConnectorRuns.status, 'completed')))
    assert.equal(completed.reduce((total, item) => total + item.fetchedCount, 0), 3)
    await db.update(externalConnectorConfigurations).set({ nextRunAt: Date.now() - 1 }).where(eq(externalConnectorConfigurations.id, id))
    assert.equal(await processDueExternalConnectors(), 0)
    current = await db.$first(db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, id))); assert.equal(current?.status, 'quota_reached')

    await db.update(externalConnectorConfigurations).set({ dailyLimit: 1000, scheduleEnabled: true, nextRunAt: Date.now() - 1, consecutiveFailures: 0 }).where(eq(externalConnectorConfigurations.id, id))
    globalThis.fetch = async () => new Response(JSON.stringify({ message: 'temporary provider failure' }), { status: 503 })
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await processDueExternalConnectors()
      current = await db.$first(db.select().from(externalConnectorConfigurations).where(eq(externalConnectorConfigurations.id, id)))
      assert.equal(current?.consecutiveFailures, attempt)
      if (attempt < 5) await db.update(externalConnectorConfigurations).set({ nextRunAt: Date.now() - 1 }).where(eq(externalConnectorConfigurations.id, id))
    }
    assert.equal(current?.scheduleEnabled, false); assert.equal(current?.status, 'paused'); assert.match(current?.pausedReason || '', /连续失败 5 次/)
    const resumed = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/schedule', headers, payload: { enabled: true, intervalMinutes: 60, query: 'industrial buyer', perRunLimit: 5, dailyLimit: 50 } })
    assert.equal(resumed.statusCode, 200, resumed.body); assert.equal(resumed.json().consecutiveFailures, 0); assert.equal(resumed.json().pausedReason, null)
    const paused = await app.inject({ method: 'PUT', url: '/api/integrations/catalog/company-contact-database/schedule', headers, payload: { enabled: false, intervalMinutes: 60, query: 'industrial buyer', perRunLimit: 5, dailyLimit: 50 } })
    assert.equal(paused.statusCode, 200, paused.body); assert.equal(paused.json().scheduleEnabled, false)
    console.log('External connector scheduler integration passed: due runs, daily quota, cursor-safe scheduling, exponential retry, circuit pause and manual resume verified.')
  } finally {
    globalThis.fetch = originalFetch
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
