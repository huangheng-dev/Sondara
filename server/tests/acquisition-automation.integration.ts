import assert from 'node:assert/strict'
import { and, eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import {
  acquisitionPlans,
  candidateContacts,
  customers,
  deals,
  inboxContacts,
  messageDeliveryEvents,
  messageEntries,
  messageThreads,
  outboundChannelConnections,
  outboxJobs,
  radarCandidates,
  radarTasks,
  tasks,
  users,
} from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { applyInboundIntentAutomation } from '../inbox/intent-automation.js'
import { queueAutomatedOutreach } from '../radar/auto-outreach.js'
import { prioritizeSources, rankDiscoveryConnectors, scoreSourcePerformance } from '../radar/optimization.js'
import { enforceAutomationCircuitBreaker } from '../radar/production-control.js'
import { applyAcquisitionFeedback, buildAcquisitionFeedbackModel, FEEDBACK_MAX_SCORE_ADJUSTMENT } from '../radar/feedback-learning.js'
import { processOutboxJob } from '../outbox/service.js'
import { cancelPendingAutomatedMessagesForThread } from '../outbox/automation-stop.js'

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
      displayName: 'Full Automation Owner', email: `full-auto-${suffix}@example.com`, password: 'Automation@2026',
    } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const workspaceId = register.json().workspace.id as string
    const headers = { cookie: cookieValue(register.headers['set-cookie']) }

    const connection = await app.inject({ method: 'POST', url: '/api/outbox/connections', headers, payload: {
      name: '自动获客测试邮箱', provider: 'smtp', host: '127.0.0.1', port: 2525, secure: false,
      username: 'sender@example.com', password: 'not-used', fromName: 'Automation', fromEmail: 'sender@example.com', priority: 1,
    } })
    assert.equal(connection.statusCode, 201, connection.body)
    const storedConnection = await db.$first(db.select().from(outboundChannelConnections).where(eq(outboundChannelConnections.id, connection.json().id)))
    assert.ok(storedConnection)
    await db.update(outboundChannelConnections).set({
      status: 'available', imapEnabled: true, imapHost: 'imap.example.com', imapUsername: 'sender@example.com',
      imapSecretCiphertext: storedConnection!.secretCiphertext, imapSecretIv: storedConnection!.secretIv,
      imapSecretTag: storedConnection!.secretTag, imapSecretEnding: storedConnection!.secretEnding, updatedAt: Date.now(),
    }).where(eq(outboundChannelConnections.id, connection.json().id))

    const planCreated = await app.inject({ method: 'POST', url: '/api/radar/plans', headers, payload: {
      name: 'Full automation integration', icp: 'Verified industrial buyers', targetRegion: 'Europe',
      candidateLimit: 10, dailyCandidateLimit: 10, dataSources: ['website'], seedUrls: ['https://example.com'],
      scheduleType: 'weekdays', runTimeLocal: '08:00', timezone: 'Asia/Shanghai', requireAi: false,
      automationMode: 'safe_autopilot', autoOutreachEnabled: true, runImmediately: true,
    } })
    assert.equal(planCreated.statusCode, 201, planCreated.body)
    const plan = await db.$first(db.select().from(acquisitionPlans).where(eq(acquisitionPlans.id, planCreated.json().plan.id)))
    const task = await db.$first(db.select().from(radarTasks).where(eq(radarTasks.id, planCreated.json().initialRun.task.id)))
    assert.ok(plan && task)
    const controlReady = await app.inject({ method: 'GET', url: '/api/radar/automation/control', headers })
    assert.equal(controlReady.statusCode, 200, controlReady.body)
    assert.equal(controlReady.json().state, 'running')
    assert.equal(controlReady.json().readyToSend, true)
    assert.equal(controlReady.json().ramps[0].limit, 5)
    const paused = await app.inject({ method: 'POST', url: '/api/radar/automation/control', headers, payload: { action: 'pause_all' } })
    assert.equal(paused.statusCode, 200, paused.body)
    assert.equal(paused.json().state, 'paused')
    const resumed = await app.inject({ method: 'POST', url: '/api/radar/automation/control', headers, payload: { action: 'resume_all' } })
    assert.equal(resumed.statusCode, 200, resumed.body)
    assert.equal(resumed.json().state, 'running')

    const customerResponse = await app.inject({ method: 'POST', url: '/api/customers', headers, payload: {
      company: 'Verified Buyer GmbH', region: 'Germany', industry: 'Industrial equipment', score: 96,
      confidence: 92, signal: '公开采购项目', source: 'AI 获客自动准入', estimatedValue: 25000, stage: '重点跟进',
    } })
    assert.equal(customerResponse.statusCode, 201, customerResponse.body)
    const customer = await db.$first(db.select().from(customers).where(eq(customers.id, customerResponse.json().id)))
    assert.ok(customer)
    const now = Date.parse('2026-08-31T01:00:00.000Z')
    const candidateId = createId('can')
    await db.insert(radarCandidates).values({
      id: candidateId, workspaceId, radarTaskId: task!.id, company: customer!.company, region: 'Germany',
      industry: 'Industrial equipment', size: '51-200', score: 96, signal: '公开采购项目', source: '企业官网',
      estimatedValue: 25000, currency: 'EUR', confidence: 92, status: 'saved',
      reason: '官网公开了与产品范围相关的采购项目。', discoveredAt: now, updatedAt: now,
    })
    const candidate = (await db.$first(db.select().from(radarCandidates).where(eq(radarCandidates.id, candidateId))))!
    const candidateContactId = createId('cct')
    await db.insert(candidateContacts).values({
      id: candidateContactId, workspaceId, candidateId, name: 'Alex Buyer', role: 'Procurement Manager',
      email: 'alex@verified-buyer.example.com', sourceUrl: 'https://example.com/contact', verificationStatus: 'verified',
      confidence: 95, createdAt: now, updatedAt: now,
    })
    const candidateContact = (await db.$first(db.select().from(candidateContacts).where(eq(candidateContacts.id, candidateContactId))))!
    const inboxContactId = createId('ict')
    await db.insert(inboxContacts).values({
      id: inboxContactId, workspaceId, customerId: customer!.id, name: candidateContact.name, company: customer!.company,
      jobTitle: candidateContact.role, region: 'Germany', source: 'AI 获客自动准入', primaryChannel: '邮件',
      email: candidateContact.email, verificationStatus: 'verified', verifiedAt: now, verificationSource: 'integration-test',
      createdAt: now, updatedAt: now,
    })

    const first = await queueAutomatedOutreach({ plan: plan!, task: task!, candidate, customer: customer!, contact: candidateContact }, {
      now,
      generateCopy: async () => ({ subject: 'Relevant industrial project', body: 'Hello Alex, your public project appears relevant to our industrial equipment scope. Would it be useful if I sent the matching technical information for review?' }),
    })
    assert.equal(first.status, 'queued')
    assert.equal(first.copyVariant, 'evidence-led')
    assert.equal(first.experimentMode, 'balanced')
    assert.equal(first.sendTimezone, 'Europe/Berlin')
    assert.equal(first.ramp.limit, 5)
    assert.ok(first.scheduledAt && first.scheduledAt > now)
    assert.equal(first.followUpJobs.length, 2)
    assert.equal((await db.select().from(outboxJobs).where(eq(outboxJobs.threadId, (await db.$first(db.select().from(outboxJobs).where(eq(outboxJobs.id, first.jobId!))))!.threadId))).length, 3)
    const queuedJob = await db.$first(db.select().from(outboxJobs).where(eq(outboxJobs.id, first.jobId!)))
    assert.equal(queuedJob?.status, 'queued')
    const automatedMessage = await db.$first(db.select().from(messageEntries).where(eq(messageEntries.threadId, queuedJob!.threadId)))
    assert.match(automatedMessage?.metadataJson ?? '', /automationApprovedByPlan/)

    const duplicate = await queueAutomatedOutreach({ plan: plan!, task: task!, candidate, customer: customer!, contact: candidateContact }, {
      now: now + 60_000,
      generateCopy: async () => ({ subject: 'Should not be generated', body: 'This message must not be queued because the thirty day duplicate contact guard has already found the first message.' }),
    })
    assert.equal(duplicate.status, 'skipped')
    assert.match(duplicate.reason ?? '', /30 天/)

    const thread = await db.$first(db.select().from(messageThreads).where(eq(messageThreads.id, queuedJob!.threadId)))
    assert.ok(thread)
    await db.update(messageThreads).set({ lastInboundAt: now + 86_400_000, updatedAt: now + 86_400_000 }).where(eq(messageThreads.id, thread!.id))
    const cancelledFollowUp = await processOutboxJob(first.followUpJobs[0].id)
    assert.equal(cancelledFollowUp.status, 'cancelled')
    assert.equal(await cancelPendingAutomatedMessagesForThread({ workspaceId, threadId: thread!.id, reason: '测试客户回复停止保护' }), 2)
    assert.equal((await db.select().from(outboxJobs).where(and(eq(outboxJobs.threadId, thread!.id), eq(outboxJobs.status, 'queued')))).length, 0)
    const intent = await applyInboundIntentAutomation({
      workspaceId, threadId: thread!.id, customerId: customer!.id, fromAddress: candidateContact.email!,
      subject: 'Re: Relevant industrial project', body: 'Please send a quotation, datasheet and lead time. We can schedule a call next week.', receivedAt: now + 86_400_000,
    })
    assert.equal(intent.intent, 'high_intent')
    assert.equal((await db.$first(db.select().from(messageThreads).where(eq(messageThreads.id, thread!.id))))?.intent, '高意向')
    assert.ok(await db.$first(db.select().from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.customerId, customer!.id), eq(tasks.source, 'AI 回复识别')))))
    assert.ok(await db.$first(db.select().from(deals).where(and(eq(deals.workspaceId, workspaceId), eq(deals.customerId, customer!.id)))))
    await db.update(messageEntries).set({ status: 'delivered', sentAt: now, deliveredAt: now, updatedAt: now }).where(eq(messageEntries.id, automatedMessage!.id))

    const performance = await app.inject({ method: 'GET', url: `/api/radar/plans/${plan!.id}/performance?days=30`, headers })
    assert.equal(performance.statusCode, 200, performance.body)
    assert.equal(performance.json().metrics.candidates, 1)
    assert.equal(performance.json().metrics.promoted, 1)
    assert.equal(performance.json().metrics.outreachQueued, 1)
    assert.equal(performance.json().metrics.replies, 1)
    assert.equal(performance.json().metrics.highIntent, 1)
    assert.equal(performance.json().metrics.deals, 1)
    assert.equal(performance.json().metrics.cancelledFollowUps, 2)
    assert.equal(performance.json().sources[0].source, '企业官网')
    assert.equal(performance.json().copyExperiment.status, 'collecting')
    assert.equal(performance.json().copyExperiment.variants[0].assigned, 1)
    assert.equal(performance.json().copyExperiment.variants[0].replies, 1)
    assert.equal(performance.json().sources[0].priority, '标准')
    assert.equal(typeof performance.json().sources[0].priorityScore, 'number')
    const learning = await app.inject({ method: 'GET', url: `/api/radar/plans/${plan!.id}/learning?days=90`, headers })
    assert.equal(learning.statusCode, 200, learning.body)
    assert.equal(learning.json().status, 'waiting')
    assert.equal(learning.json().labeledOutcomes, 1)
    assert.equal(learning.json().minimumOutcomes, 8)
    const feedbackModel = buildAcquisitionFeedbackModel([
      ...Array.from({ length: 5 }, () => ({ outcome: 'positive' as const, source: '企业官网', industry: '工业设备', region: '德国', signal: '公开采购项目' })),
      ...Array.from({ length: 3 }, () => ({ outcome: 'negative' as const, source: '搜索发现', industry: '消费零售', region: '其他地区', signal: '普通企业信息' })),
    ])
    assert.equal(feedbackModel.status, 'active')
    const feedbackCandidate = { company: candidate.company, size: candidate.size, score: candidate.score, estimatedValue: candidate.estimatedValue,
      currency: 'EUR' as const, confidence: candidate.confidence, reason: candidate.reason, evidence: [], committee: [], relationships: [], dimensions: [] }
    const positiveAdjustment = applyAcquisitionFeedback(feedbackModel, { ...feedbackCandidate, source: '企业官网', industry: '工业设备', region: '德国', signal: '公开采购项目' })
    const negativeAdjustment = applyAcquisitionFeedback(feedbackModel, { ...feedbackCandidate, source: '搜索发现', industry: '消费零售', region: '其他地区', signal: '普通企业信息' })
    assert.ok(positiveAdjustment.adjustment > 0)
    assert.ok(negativeAdjustment.adjustment < 0)
    assert.ok(Math.abs(positiveAdjustment.adjustment) <= FEEDBACK_MAX_SCORE_ADJUSTMENT)
    assert.ok(Math.abs(negativeAdjustment.adjustment) <= FEEDBACK_MAX_SCORE_ADJUSTMENT)
    const priorities = prioritizeSources([
      { source: '企业官网', candidates: 20, highMatch: 15, promoted: 10, outreach: 8, replies: 3 },
      { source: '搜索发现', candidates: 20, highMatch: 2, promoted: 0, outreach: 8, replies: 0 },
    ])
    assert.equal(priorities[0].source, '企业官网')
    assert.ok(scoreSourcePerformance(priorities[0]) > scoreSourcePerformance(priorities[1]))
    const rankedConnectors = rankDiscoveryConnectors([
      { id: 'search-discovery', label: '搜索', supports: () => true, discover: async () => [] },
      { id: 'website-seed', label: '官网', supports: () => true, discover: async () => [] },
    ], priorities)
    assert.equal(rankedConnectors[0].id, 'website-seed')

    await db.insert(messageDeliveryEvents).values({
      id: createId('mde'), workspaceId, outboxJobId: queuedJob!.id, messageId: automatedMessage!.id,
      eventType: 'complained', status: 'completed', metadataJson: '{}', createdAt: now + 2 * 86_400_000,
    })
    const breaker = await enforceAutomationCircuitBreaker(workspaceId)
    assert.equal(breaker.safe, false)
    assert.equal(breaker.pausedPlans, 1)
    assert.match((await db.$first(db.select().from(acquisitionPlans).where(eq(acquisitionPlans.id, plan!.id))))?.lastError ?? '', /自动触达已熔断/)

    console.log('Acquisition automation integration passed: verified-contact gate, queued first touch, feedback learning, 30-day dedupe, high-intent reply classification, task and deal creation verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
