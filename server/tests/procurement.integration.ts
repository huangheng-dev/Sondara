import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { customers, procurementOpportunities, procurementSubscriptions, radarCandidates, radarTasks, tasks, users } from '../db/schema.js'

const cookieValue = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.split(';')[0] ?? ''

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  let userId = ''; let workspaceId = ''
  const originalFetch = globalThis.fetch
  try {
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Procurement Owner', email: `procurement-${suffix}@integration.local`, password: 'Procurement@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id; workspaceId = register.json().workspace.id
    const headers = { cookie: cookieValue(register.headers['set-cookie']) }

    const providers = await app.inject({ method: 'GET', url: '/api/procurement/providers', headers })
    assert.equal(providers.statusCode, 200, providers.body)
    assert.ok(providers.json().items.some((item: { provider: string; configured: boolean }) => item.provider === 'ted' && item.configured))
    assert.ok(providers.json().items.some((item: { provider: string; mode: string; configured: boolean }) => item.provider === 'world-bank' && item.mode === 'official_api' && item.configured))
    assert.equal(providers.json().items.length, 4)
    assert.ok(providers.json().items.every((item: { sourceUrl?: string }) => item.sourceUrl?.startsWith('https://')))

    const created = await app.inject({ method: 'POST', url: '/api/procurement/subscriptions', headers, payload: { name: `EU Software ${suffix}`, provider: 'ted', keywords: ['software'], regions: ['DEU'], noticeTypes: [] } })
    assert.equal(created.statusCode, 201, created.body)
    const subscriptionId = created.json().id

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const sent = JSON.parse(String(init?.body)) as { query: string; scope: string }
      assert.match(sent.query, /software/)
      assert.match(sent.query, /DEU/)
      assert.equal(sent.scope, 'ACTIVE')
      return new Response(JSON.stringify({ timedOut: false, notices: [{
        'publication-number': '123456-2026',
        'notice-title': { eng: 'Enterprise software platform procurement' },
        'buyer-name': { eng: ['Example Public Agency'] },
        'publication-date': '2026-08-20+02:00',
        'deadline-receipt-tender-date-lot': ['2026-09-30T12:00:00+02:00'],
        'place-of-performance-country-lot': ['DEU'],
        'notice-type': 'cn-standard',
        links: { html: { ENG: 'https://ted.europa.eu/en/notice/-/detail/123456-2026' } },
      }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const sync = await app.inject({ method: 'POST', url: `/api/procurement/subscriptions/${subscriptionId}/sync`, headers })
    assert.equal(sync.statusCode, 200, sync.body)
    assert.deepEqual({ received: sync.json().received, created: sync.json().created, updated: sync.json().updated }, { received: 1, created: 1, updated: 0 })
    assert.ok(sync.json().radarTaskId)
    const acquisitionTask = await db.$first(db.select().from(radarTasks).where(eq(radarTasks.id, sync.json().radarTaskId)))
    const acquisitionCandidate = await db.$first(db.select().from(radarCandidates).where(eq(radarCandidates.radarTaskId, sync.json().radarTaskId)))
    assert.equal(acquisitionTask?.status, 'completed')
    assert.equal(acquisitionTask?.strategy, '采购项目监控')
    assert.equal(acquisitionCandidate?.company, 'Example Public Agency')
    assert.equal(acquisitionCandidate?.signal, '发布采购公告')

    const secondSync = await app.inject({ method: 'POST', url: `/api/procurement/subscriptions/${subscriptionId}/sync`, headers })
    assert.equal(secondSync.statusCode, 200, secondSync.body)
    assert.equal(secondSync.json().created, 0)
    assert.equal(secondSync.json().updated, 1)

    const list = await app.inject({ method: 'GET', url: '/api/procurement/opportunities?q=software', headers })
    assert.equal(list.statusCode, 200, list.body)
    assert.equal(list.json().total, 1)
    const opportunity = list.json().items[0]
    assert.equal(opportunity.buyer, 'Example Public Agency')
    assert.equal(opportunity.country, 'DEU')
    assert.ok(opportunity.relevanceScore >= 90)
    const sorted = await app.inject({ method: 'GET', url: '/api/procurement/opportunities?sort=deadline_asc', headers })
    assert.equal(sorted.statusCode, 200, sorted.body)
    assert.equal(sorted.json().items[0].id, opportunity.id)
    const invalidSort = await app.inject({ method: 'GET', url: '/api/procurement/opportunities?sort=unsupported', headers })
    assert.equal(invalidSort.statusCode, 400)

    const saved = await app.inject({ method: 'POST', url: `/api/procurement/opportunities/${opportunity.id}/save`, headers })
    assert.equal(saved.statusCode, 200, saved.body)
    assert.ok(saved.json().customerId)
    assert.ok(saved.json().taskId)
    const customer = await db.$first(db.select().from(customers).where(eq(customers.id, saved.json().customerId)))
    const task = await db.$first(db.select().from(tasks).where(eq(tasks.id, saved.json().taskId)))
    assert.equal(customer?.company, 'Example Public Agency')
    assert.equal(customer?.source, '采购机会 · ted')
    assert.equal(task?.source, '采购机会 · ted')
    assert.equal(task?.company, 'Example Public Agency')
    assert.equal(task?.customerId, customer?.id)

    const savedAgain = await app.inject({ method: 'POST', url: `/api/procurement/opportunities/${opportunity.id}/save`, headers })
    assert.equal(savedAgain.statusCode, 200, savedAgain.body)
    assert.equal(savedAgain.json().customerId, customer?.id)
    assert.equal(savedAgain.json().taskId, task?.id)

    const dismissed = await app.inject({ method: 'DELETE', url: `/api/procurement/opportunities/${opportunity.id}`, headers })
    assert.equal(dismissed.statusCode, 204, dismissed.body)
    const afterDismiss = await app.inject({ method: 'GET', url: '/api/procurement/opportunities', headers })
    assert.equal(afterDismiss.json().total, 0)

    const updated = await app.inject({ method: 'PATCH', url: `/api/procurement/subscriptions/${subscriptionId}`, headers, payload: { enabled: false } })
    assert.equal(updated.statusCode, 200, updated.body)
    assert.equal(updated.json().enabled, false)
    const disabledSync = await app.inject({ method: 'POST', url: `/api/procurement/subscriptions/${subscriptionId}/sync`, headers })
    assert.equal(disabledSync.statusCode, 409)

    const removed = await app.inject({ method: 'DELETE', url: `/api/procurement/subscriptions/${subscriptionId}`, headers })
    assert.equal(removed.statusCode, 204)

    const worldBankCreated = await app.inject({ method: 'POST', url: '/api/procurement/subscriptions', headers, payload: { name: `World Bank Automation ${suffix}`, provider: 'world-bank', keywords: ['automation'], regions: [], noticeTypes: ['Request for Expression of Interest'] } })
    assert.equal(worldBankCreated.statusCode, 201, worldBankCreated.body)
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      assert.equal(url.hostname, 'search.worldbank.org')
      assert.equal(url.searchParams.get('qterm'), 'automation')
      assert.equal(url.searchParams.get('notice_type_exact'), 'Request for Expression of Interest')
      return new Response(JSON.stringify({ rows: 1, total: 1, procnotices: [{ id: 'OP00999999', notice_type: 'Request for Expression of Interest', notice_status: 'Published', project_ctry_name: 'Kenya', project_id: 'P123456', project_name: 'Digital Industry Project', bid_reference_no: 'KE-001-CS-QCBS', bid_description: 'Industrial automation advisory services', procurement_method_name: 'Quality And Cost-Based Selection', submission_date: '2026-08-20T00:00:00Z', submission_deadline_date: '2026-09-30T00:00:00Z' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch
    const worldBankSync = await app.inject({ method: 'POST', url: `/api/procurement/subscriptions/${worldBankCreated.json().id}/sync`, headers })
    assert.equal(worldBankSync.statusCode, 200, worldBankSync.body)
    assert.equal(worldBankSync.json().created, 1)
    const worldBankList = await app.inject({ method: 'GET', url: '/api/procurement/opportunities?provider=world-bank', headers })
    assert.equal(worldBankList.statusCode, 200, worldBankList.body)
    assert.equal(worldBankList.json().items[0].externalId, 'OP00999999')
    assert.match(worldBankList.json().items[0].sourceUrl, /projects\.worldbank\.org/)

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/procurement/opportunities' })
    assert.equal(unauthenticated.statusCode, 401)
    console.log('Procurement integration passed: TED and World Bank public APIs, subscription lifecycle, dedupe, opportunity task closure and workspace authorization verified.')
  } finally {
    globalThis.fetch = originalFetch
    if (workspaceId) {
      await db.delete(tasks).where(eq(tasks.workspaceId, workspaceId))
      await db.delete(procurementOpportunities).where(eq(procurementOpportunities.workspaceId, workspaceId))
      await db.delete(procurementSubscriptions).where(eq(procurementSubscriptions.workspaceId, workspaceId))
      await db.delete(radarCandidates).where(eq(radarCandidates.workspaceId, workspaceId))
      await db.delete(radarTasks).where(eq(radarTasks.workspaceId, workspaceId))
      await db.delete(customers).where(eq(customers.workspaceId, workspaceId))
    }
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
