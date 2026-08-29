import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { companySignals, users } from '../db/schema.js'
import { detectIntentSignals, storeCandidateSignals } from '../radar/signal-engine.js'

const run = async () => {
  const app = await buildApp()
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  let userId = ''; let workspaceId = ''
  try {
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Signal Owner', email: `signals-${suffix}@integration.local`, password: 'Signals@2026' } })
    assert.equal(registered.statusCode, 201, registered.body)
    userId = registered.json().user.id; workspaceId = registered.json().workspace.id
    const cookie = (Array.isArray(registered.headers['set-cookie']) ? registered.headers['set-cookie'][0] : registered.headers['set-cookie'])?.split(';')[0] ?? ''
    const headers = { cookie }

    const task = await app.inject({ method: 'POST', url: '/api/radar/tasks', headers, payload: { name: `Signals ${suffix}`, icp: 'Enterprise software buyer', strategy: '目标企业发现', dataSources: ['website'], intentSignals: ['扩张建设', '招聘变化'], candidateLimit: 5, targetRegion: 'Europe', seedUrls: ['https://example-growth.test'] } })
    assert.equal(task.statusCode, 201, task.body)

    const candidateInput = {
      radarTaskId: task.json().id, company: 'Example Growth GmbH', region: 'Germany', industry: 'Software', size: '200-500', score: 70,
      signal: '公开企业发现', source: '搜索引擎', estimatedValue: 100000, currency: 'EUR' as const, confidence: 72, status: 'candidate',
      reason: 'Company announced a new office and is hiring implementation managers.', dimensions: [{ label: 'ICP 匹配', score: 75 }],
      evidence: [{ title: 'Example Growth opens new office and starts hiring', source: 'Company newsroom', time: '2026-08-20', strength: '强' as const, sourceUrl: 'https://example-growth.test/news/new-office' }],
      committee: [], relationships: [],
    }
    const candidate = await app.inject({ method: 'POST', url: '/api/radar/candidates', headers, payload: candidateInput })
    assert.equal(candidate.statusCode, 201, candidate.body)

    const detected = detectIntentSignals({ id: task.json().id, workspaceId, name: 'Signals', icp: 'Enterprise software buyer', mode: '智能多渠道', strategy: '目标企业发现', dataSources: ['website'], intentSignals: ['扩张建设', '招聘变化'], depth: '标准研究', candidateLimit: 5, targetRegion: 'Europe', researchLanguage: 'English', seedUrls: ['https://example-growth.test'] }, candidateInput)
    assert.equal(detected.signals.length, 2)
    assert.ok(detected.candidate.score > candidateInput.score)
    const stored = await storeCandidateSignals({ workspaceId, candidateId: candidate.json().id, company: candidateInput.company, signals: detected.signals })
    assert.equal(stored, 2)
    const storedAgain = await storeCandidateSignals({ workspaceId, candidateId: candidate.json().id, company: candidateInput.company, signals: detected.signals })
    assert.equal(storedAgain, 0)

    const candidates = await app.inject({ method: 'GET', url: `/api/radar/candidates?taskId=${task.json().id}`, headers })
    assert.equal(candidates.statusCode, 200, candidates.body)
    assert.equal(candidates.json().items[0].intentSignals.length, 2)
    assert.ok(candidates.json().items[0].intentSignals.every((item: { sourceUrl: string }) => item.sourceUrl.startsWith('https://')))

    const promoted = await app.inject({ method: 'POST', url: `/api/radar/candidates/${candidate.json().id}/promote`, headers })
    assert.ok([200, 201].includes(promoted.statusCode), promoted.body)
    const signals = await app.inject({ method: 'GET', url: `/api/customers/${promoted.json().customer.id}/signals`, headers })
    assert.equal(signals.statusCode, 200, signals.body)
    assert.equal(signals.json().items.length, 2)
    assert.ok(signals.json().items.every((item: { customerId: string }) => item.customerId === promoted.json().customer.id))

    console.log('Signal engine integration passed: evidence-only detection, score boost, dedupe, candidate presentation and customer signal continuity verified.')
  } finally {
    if (workspaceId) await db.delete(companySignals).where(eq(companySignals.workspaceId, workspaceId))
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
