import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import {
  channelCosts, customers, deals, tasks, users,
} from '../db/schema.js'

const run = async () => {
  const app = await buildApp()
  const email = `attr-${Date.now()}@integration.local`
  let userId = ''
  let workspaceId = ''
  try {
    const register = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { displayName: 'Attribution Test', email, password: 'Attr@2026' },
    })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    workspaceId = register.json().workspace.id
    const cookie = register.headers['set-cookie']
    assert.ok(cookie)
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie }

    // Overview with no data
    const empty = await app.inject({ method: 'GET', url: '/api/attribution/overview?period=month', headers })
    assert.equal(empty.statusCode, 200, empty.body)
    assert.ok(Array.isArray(empty.json().funnel))
    assert.equal(empty.json().funnel.length, 6)
    assert.equal(empty.json().funnel.every((s: { value: number }) => s.value === 0), true)

    // Insert test data directly: a customer with source 'search' and a won deal
    const now = Date.now()
    const today = new Date()
    const monthStart = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 2)
    await db.insert(customers).values({
            id: 'cus-test-attr-1', workspaceId, company: 'Test GmbH',
            region: 'Germany', industry: 'Food Equipment', source: '搜索引擎',
            stage: '已成交', score: 80, confidence: 70, signal: 'Active',
            estimatedValue: 500000, size: '50-200', contacts: 2, validContacts: 1,
            interaction: 'Replied', nextAction: 'Follow up', createdAt: monthStart + 86400000, updatedAt: now,
          })

    await db.insert(deals).values({
            id: 'dea-test-attr-1', workspaceId, customerId: 'cus-test-attr-1',
            company: 'Test GmbH', stage: '赢单', probability: 100,
            valueAmount: 500000, currency: 'EUR', source: '搜索引擎',
            ownerLabel: '我', nextAction: '交付', risk: '低',
            stageEnteredAt: now, createdAt: monthStart + 172800000, updatedAt: now,
          })

    // Overview should now show the customer and deal
    const overview = await app.inject({ method: 'GET', url: '/api/attribution/overview?period=month&currency=EUR', headers })
    assert.equal(overview.statusCode, 200, overview.body)
    const data = overview.json()
    assert.ok(data.funnel.find((s: { key: string }) => s.key === 'qualified').value >= 1)
    assert.ok(data.funnel.find((s: { key: string }) => s.key === 'won').value >= 1)
    assert.ok(data.totals.revenue >= 500000)

    // Channel costs CRUD
    const costStart = monthStart
    const costEnd = Date.now()
    const created = await app.inject({
      method: 'POST', url: '/api/attribution/costs', headers,
      payload: {
        channel: '搜索引擎', periodLabel: 'monthly',
        periodStart: costStart, periodEnd: costEnd,
        costAmount: 5000, currency: 'EUR', note: 'Brave API credits',
      },
    })
    assert.equal(created.statusCode, 201, created.body)
    const costId = created.json().id

    // List costs
    const list = await app.inject({ method: 'GET', url: '/api/attribution/costs', headers })
    assert.equal(list.statusCode, 200)
    assert.equal(list.json().total, 1)

    // Overview now includes cost and ROI
    const withCost = await app.inject({ method: 'GET', url: '/api/attribution/overview?period=month&currency=EUR', headers })
    assert.equal(withCost.json().totals.cost, 5000)
    assert.ok(withCost.json().totals.roi !== null)
    assert.ok(withCost.json().channels.find((c: { name: string }) => c.name === '搜索引擎').cost === 5000)

    // PATCH cost
    const patched = await app.inject({
      method: 'PATCH', url: `/api/attribution/costs/${costId}`, headers,
      payload: { costAmount: 6000 },
    })
    assert.equal(patched.statusCode, 200, patched.body)
    assert.equal(patched.json().costAmount, 6000)

    // DELETE cost
    const removed = await app.inject({ method: 'DELETE', url: `/api/attribution/costs/${costId}`, headers })
    assert.equal(removed.statusCode, 204)

    // Create optimize tasks
    const opt = await app.inject({
      method: 'POST', url: '/api/attribution/optimize-tasks', headers,
      payload: { period: 'month', channels: [] },
    })
    assert.equal(opt.statusCode, 201, opt.body)
    assert.ok(opt.json().created >= 1)
    assert.ok(Array.isArray(opt.json().taskIds))

    // Verify tasks exist
    const createdTasks = (await db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId)))
    assert.ok(createdTasks.length >= 1)
    assert.ok(createdTasks.some(t => t.source === '转化分析'))

    // Quality endpoint
    const quality = await app.inject({ method: 'GET', url: '/api/attribution/quality', headers })
    assert.equal(quality.statusCode, 200)
    assert.ok(Array.isArray(quality.json().items))
    assert.equal(quality.json().items.length, 3)

    // Cross-workspace isolation
    const otherReg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { displayName: 'Other', email: `other-${Date.now()}@integration.local`, password: 'Attr@2026' },
    })
    const otherCookie = otherReg.headers['set-cookie']
    const otherHeaders = { cookie: Array.isArray(otherCookie) ? otherCookie[0] : otherCookie }
    const otherOverview = await app.inject({ method: 'GET', url: '/api/attribution/overview', headers: otherHeaders })
    assert.equal(otherOverview.json().funnel.every((s: { value: number }) => s.value === 0), true)

    // Unauthenticated
    const unauth = await app.inject({ method: 'GET', url: '/api/attribution/overview' })
    assert.equal(unauth.statusCode, 401)

    // Validation: bad period
    const badPeriod = await app.inject({ method: 'GET', url: '/api/attribution/overview?period=weekly', headers })
    assert.equal(badPeriod.statusCode, 400)

    console.log('Attribution integration passed: funnel aggregation, costs CRUD, optimize tasks, quality and workspace isolation verified.')
  } finally {
    if (userId) {
      await db.delete(tasks).where(eq(tasks.workspaceId, workspaceId))
      await db.delete(channelCosts).where(eq(channelCosts.workspaceId, workspaceId))
      await db.delete(deals).where(eq(deals.workspaceId, workspaceId))
      await db.delete(customers).where(eq(customers.workspaceId, workspaceId))
      await db.delete(users).where(eq(users.id, userId))
    }
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
