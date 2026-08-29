import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { customers, deals, tasks, users } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { getSalesProgressionSummary, reconcileSalesProgression } from '../sales/progression-guardian.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const app = await buildApp()
  let userId = ''
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: {
      displayName: 'Sales Guardian Owner', email: `sales-guardian-${suffix}@example.com`, password: 'Guardian@2026',
    } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const workspaceId = register.json().workspace.id as string
    const headers = { cookie: cookieValue(register.headers['set-cookie']) }
    const customerResponse = await app.inject({ method: 'POST', url: '/api/customers', headers, payload: {
      company: 'Guardian Buyer GmbH', region: 'Germany', industry: 'Industrial equipment', score: 92,
      confidence: 90, signal: '主动询价', source: '邮件询盘', estimatedValue: 42000, stage: '重点跟进',
    } })
    assert.equal(customerResponse.statusCode, 201, customerResponse.body)
    const customerId = customerResponse.json().id as string
    const thread = await app.inject({ method: 'POST', url: '/api/inbox/threads', headers, payload: {
      customerId, subject: 'Request for quotation', channel: '邮件', intent: '高意向',
      contact: { name: 'Alex Buyer', company: 'Guardian Buyer GmbH', jobTitle: 'Procurement Manager', region: 'Germany', email: 'alex@guardian.example.com' },
      initialMessage: 'Please send a quotation, technical data and lead time for our project.',
    } })
    assert.equal(thread.statusCode, 201, thread.body)
    const now = Date.now() + 5 * 60 * 60_000
    const first = await reconcileSalesProgression({ workspaceId, now })
    assert.equal(first.highIntentTasksCreated, 1)
    assert.equal(first.missingDealsCreated, 1)
    const handoffTasks = await db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.customerId, customerId), eq(tasks.source, '商机推进守护')))
    assert.equal(handoffTasks.length, 1)
    assert.equal(handoffTasks[0].priority, '高')
    assert.equal(handoffTasks[0].dueLabel, '已逾期 · 立即处理')
    assert.equal((await db.select().from(deals).where(and(eq(deals.workspaceId, workspaceId), eq(deals.customerId, customerId)))).length, 1)

    const second = await reconcileSalesProgression({ workspaceId, now: now + 60_000 })
    assert.equal(second.highIntentTasksCreated, 0)
    assert.equal(second.missingDealsCreated, 0)
    assert.equal((await db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.customerId, customerId), eq(tasks.source, '商机推进守护')))).length, 1)

    const staleCustomerId = createId('cus')
    await db.insert(customers).values({
      id: staleCustomerId, workspaceId, company: 'Stale Opportunity Ltd', region: 'United Kingdom', industry: 'Engineering',
      score: 80, confidence: 80, signal: '项目评估', source: '客户消息', estimatedValue: 30000, stage: '有商机',
      contacts: 1, validContacts: 1, interaction: '等待客户内部评估', nextAction: '确认评估结果和下一次会议',
      ownerUserId: userId, createdAt: now - 20 * 86_400_000, updatedAt: now - 11 * 86_400_000,
    })
    const staleDealId = createId('dea')
    await db.insert(deals).values({
      id: staleDealId, workspaceId, customerId: staleCustomerId, company: 'Stale Opportunity Ltd', stage: '方案评估', probability: 60,
      valueAmount: 30000, currency: 'EUR', ownerLabel: '负责人', nextAction: '确认评估结果和下一次会议', expectedCloseAt: now + 30 * 86_400_000,
      risk: '客户内部评估时间过长', source: '客户消息', stageEnteredAt: now - 11 * 86_400_000, ownerUserId: userId,
      createdAt: now - 20 * 86_400_000, updatedAt: now - 11 * 86_400_000,
    })
    const staleResult = await reconcileSalesProgression({ workspaceId, now })
    assert.equal(staleResult.staleDealTasksCreated, 1)
    const staleTask = await db.$first(db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.customerId, staleCustomerId), eq(tasks.source, '商机推进守护'))))
    assert.ok(staleTask)
    assert.match(staleTask!.title, /停滞商机/)
    const summary = await getSalesProgressionSummary(workspaceId, now)
    assert.equal(summary.highIntentOpen, 1)
    assert.ok(summary.guardianTasks >= 2)
    assert.ok(summary.staleDeals >= 1)

    await db.update(deals).set({ stage: '赢单', stageEnteredAt: now, updatedAt: now }).where(eq(deals.id, staleDealId))
    const wonResult = await reconcileSalesProgression({ workspaceId, now: now + 60_000 })
    assert.equal(wonResult.resolvedGuardianTasks, 1)
    assert.equal((await db.$first(db.select().from(tasks).where(eq(tasks.id, staleTask!.id))))?.status, 'completed')
    const brief = await app.inject({ method: 'GET', url: '/api/radar/automation/brief', headers })
    assert.equal(brief.statusCode, 200, brief.body)
    assert.equal(typeof brief.json().salesGuardian.overdueTasks, 'number')

    console.log('Sales progression guardian integration passed: missing handoff recovery, deal creation, overdue escalation, stale-deal tasking, idempotency and win resolution verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
