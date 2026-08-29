import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { reconcileClosedLoop } from '../automation/closed-loop.js'
import { db } from '../db/client.js'
import { acquisitionPlans, customerOutcomes, replySuggestions, tasks, users, workspaceNotifications, workspaces } from '../db/schema.js'
import { createId } from '../lib/ids.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const app = await buildApp(); let userId = ''
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Closure Owner', email: `closure-${suffix}@example.com`, password: 'Closure@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id; const workspaceId = register.json().workspace.id as string
    const headers = { cookie: cookieValue(register.headers['set-cookie']) }
    const customer = await app.inject({ method: 'POST', url: '/api/customers', headers, payload: { company: 'Closure Buyer GmbH', region: 'Germany', industry: 'Engineering', score: 93, confidence: 90, signal: '主动询价', source: '邮件询盘', estimatedValue: 68000, stage: '重点跟进' } })
    assert.equal(customer.statusCode, 201, customer.body); const customerId = customer.json().id as string
    const thread = await app.inject({ method: 'POST', url: '/api/inbox/threads', headers, payload: { customerId, subject: 'RFQ and meeting', channel: '邮件', intent: '高意向', contact: { name: 'Anna Buyer', company: 'Closure Buyer GmbH', jobTitle: 'Procurement', region: 'Germany', email: 'anna@closure.example.com' }, initialMessage: 'Please provide quotation and arrange a technical meeting.' } })
    assert.equal(thread.statusCode, 201, thread.body); const threadId = thread.json().id as string
    const suggestion = await app.inject({ method: 'GET', url: `/api/automation/reply-suggestions/${threadId}`, headers })
    assert.equal(suggestion.statusCode, 200, suggestion.body); assert.equal(suggestion.json().requiresHumanConfirmation, true)
    assert.equal((await db.select().from(replySuggestions).where(eq(replySuggestions.threadId, threadId))).length, 1)

    await reconcileClosedLoop({ workspaceId, now: Date.now() + 5 * 60 * 60_000 })
    const notifications = await app.inject({ method: 'GET', url: '/api/automation/notifications', headers })
    assert.equal(notifications.statusCode, 200, notifications.body); assert.ok(notifications.json().unreadTotal >= 1)
    assert.ok((await db.select().from(workspaceNotifications).where(eq(workspaceNotifications.workspaceId, workspaceId))).some(item => item.actionPath?.includes('/inbox')))
    const readAll = await app.inject({ method: 'POST', url: '/api/automation/notifications/read-all', headers })
    assert.equal(readAll.statusCode, 200, readAll.body)

    const deal = await app.inject({ method: 'POST', url: '/api/deals', headers, payload: { customerId, company: 'Closure Buyer GmbH', stage: '需求确认', valueAmount: 68000, currency: 'EUR', ownerLabel: 'Closure Owner', nextAction: 'Confirm specifications', risk: 'Budget not confirmed' } })
    assert.equal(deal.statusCode, 201, deal.body); const dealId = deal.json().id as string
    const invalidLoss = await app.inject({ method: 'PATCH', url: `/api/deals/${dealId}`, headers, payload: { stage: '输单' } })
    assert.equal(invalidLoss.statusCode, 400, invalidLoss.body)
    const loss = await app.inject({ method: 'PATCH', url: `/api/deals/${dealId}`, headers, payload: { stage: '输单', outcomeReason: '预算取消' } })
    assert.equal(loss.statusCode, 200, loss.body); assert.equal(loss.json().stage, '输单'); assert.equal(loss.json().outcomeReason, '预算取消')
    assert.equal((await db.select().from(customerOutcomes).where(and(eq(customerOutcomes.workspaceId, workspaceId), eq(customerOutcomes.dealId, dealId)))).at(-1)?.outcome, 'lost')

    const activeDeal = await app.inject({ method: 'POST', url: '/api/deals', headers, payload: { company: 'Recommendation Buyer Ltd', stage: '方案评估', valueAmount: 42000, currency: 'USD', ownerLabel: 'Closure Owner', nextAction: 'Arrange technical review', risk: 'Evaluation timing unclear' } })
    assert.equal(activeDeal.statusCode, 201, activeDeal.body); const activeDealId = activeDeal.json().id as string
    const recommendation = await app.inject({ method: 'GET', url: `/api/automation/deals/${activeDealId}/recommendation`, headers })
    assert.equal(recommendation.statusCode, 200, recommendation.body); assert.ok(recommendation.json().nextAction)
    const accepted = await app.inject({ method: 'POST', url: `/api/automation/recommendations/${recommendation.json().id}/accept`, headers })
    assert.equal(accepted.statusCode, 200, accepted.body)
    const acceptedTask = await db.$first(db.select().from(tasks).where(eq(tasks.id, accepted.json().taskId)))
    assert.equal(acceptedTask?.entityType, 'deal'); assert.match(acceptedTask?.actionPath ?? '', /pipeline/)

    const now = Date.now(); const planId = createId('acp')
    await db.insert(acquisitionPlans).values({ id: planId, workspaceId, ownerUserId: userId, name: 'Closure simulation', icp: 'Industrial distributors', mode: '智能多渠道', strategy: '目标企业发现', dataSourcesJson: '["website"]', intentSignalsJson: '["采购公告"]', depth: '标准研究', candidateLimit: 20, dailyCandidateLimit: 20, knowledgeScope: '全部资料', targetRegion: 'Europe', researchLanguage: 'English', inputSource: 'AI 获客', seedUrlsJson: '[]', scheduleType: 'manual', runTimeLocal: '08:00', timezone: 'Asia/Shanghai', weekdaysJson: '[1,2,3,4,5]', enabled: true, status: 'active', requireAi: false, automationMode: 'safe_autopilot', minAutoScore: 90, autoPromoteEnabled: true, autoOutreachEnabled: false, consecutiveFailures: 0, totalRuns: 0, createdAt: now, updatedAt: now })
    const simulation = await app.inject({ method: 'POST', url: `/api/automation/plans/${planId}/simulate`, headers })
    assert.equal(simulation.statusCode, 200, simulation.body); assert.equal(simulation.json().steps.length, 5)
    const versions = await app.inject({ method: 'GET', url: `/api/automation/plans/${planId}/learning-versions`, headers })
    assert.equal(versions.statusCode, 200, versions.body); assert.equal(versions.json().items.length, 1)
    const runs = await app.inject({ method: 'GET', url: '/api/automation/runs', headers })
    assert.equal(runs.statusCode, 200, runs.body); assert.ok(runs.json().items.some((item: { id: string }) => item.id === simulation.json().id))
    const accountDeletion = await app.inject({ method: 'DELETE', url: '/api/auth/account', headers, payload: { currentPassword: 'Closure@2026', confirmation: 'DELETE' } })
    assert.equal(accountDeletion.statusCode, 204, accountDeletion.body)
    assert.equal(await db.$first(db.select({ id: users.id }).from(users).where(eq(users.id, userId))), undefined)
    assert.equal(await db.$first(db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId))), undefined)
    userId = ''
    console.log('Automation closure integration passed: persistent suggestions, notifications, structured outcomes, loss reasons, deep-linked tasks, sales recommendations, simulation, trace, learning versions and owner workspace deletion verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
