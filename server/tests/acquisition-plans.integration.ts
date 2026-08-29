import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { radarTasks, users } from '../db/schema.js'
import { computeNextPlanRunAt } from '../radar/acquisition-plans.js'

const cookieValue = (setCookie: string | string[] | undefined) => {
  const value = Array.isArray(setCookie) ? setCookie[0] : setCookie
  return value ? value.split(';')[0] : ''
}

const run = async () => {
  const app = await buildApp()
  let userId = ''
  try {
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'Automation Owner', email: `automation-${suffix}@example.com`, password: 'Automation@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const headers = { cookie: cookieValue(register.headers['set-cookie']) }
    const created = await app.inject({ method: 'POST', url: '/api/radar/plans', headers, payload: {
      name: 'Europe distributor automation', icp: 'European hygienic process equipment distributors',
      targetRegion: 'Europe', candidateLimit: 20, dailyCandidateLimit: 20,
      dataSources: ['website'], seedUrls: ['https://example.com'], intentSignals: ['采购公告'],
      scheduleType: 'weekdays', runTimeLocal: '08:00', timezone: 'Asia/Shanghai',
      requireAi: false, automationMode: 'research_only', runImmediately: true,
    } })
    assert.equal(created.statusCode, 201, created.body)
    assert.equal(created.json().plan.status, 'active')
    assert.ok(created.json().plan.nextRunAt)
    assert.ok(created.json().initialRun?.task?.id)
    const planId = created.json().plan.id as string
    const taskId = created.json().initialRun.task.id as string
    const task = await db.$first(db.select().from(radarTasks).where(eq(radarTasks.id, taskId)))
    assert.equal(task?.acquisitionPlanId, planId)
    assert.equal(task?.runNumber, 1)

    const enabledOutreach = await app.inject({ method: 'PATCH', url: `/api/radar/plans/${planId}`, headers, payload: {
      automationMode: 'safe_autopilot', autoOutreachEnabled: true,
    } })
    assert.equal(enabledOutreach.statusCode, 200, enabledOutreach.body)
    assert.equal(enabledOutreach.json().autoPromoteEnabled, true)
    assert.equal(enabledOutreach.json().autoOutreachEnabled, true)
    const returnedToResearch = await app.inject({ method: 'PATCH', url: `/api/radar/plans/${planId}`, headers, payload: {
      automationMode: 'research_only', autoOutreachEnabled: true,
    } })
    assert.equal(returnedToResearch.statusCode, 200, returnedToResearch.body)
    assert.equal(returnedToResearch.json().autoPromoteEnabled, false)
    assert.equal(returnedToResearch.json().autoOutreachEnabled, false)

    const busyRun = await app.inject({ method: 'POST', url: `/api/radar/plans/${planId}/actions`, headers, payload: { action: 'run' } })
    assert.equal(busyRun.statusCode, 409)
    const paused = await app.inject({ method: 'POST', url: `/api/radar/plans/${planId}/actions`, headers, payload: { action: 'pause' } })
    assert.equal(paused.statusCode, 200, paused.body)
    assert.equal(paused.json().status, 'paused')
    const resumed = await app.inject({ method: 'POST', url: `/api/radar/plans/${planId}/actions`, headers, payload: { action: 'resume' } })
    assert.equal(resumed.statusCode, 200, resumed.body)
    assert.equal(resumed.json().status, 'active')
    assert.ok(resumed.json().nextRunAt)

    const brief = await app.inject({ method: 'GET', url: '/api/radar/automation/brief', headers })
    assert.equal(brief.statusCode, 200, brief.body)
    assert.equal(brief.json().activePlans, 1)
    assert.equal(brief.json().activeRuns, 1)

    const fridayMorning = Date.parse('2026-08-28T01:00:00.000Z')
    const nextWeekday = computeNextPlanRunAt({ scheduleType: 'weekdays', runTimeLocal: '08:00', timezone: 'Asia/Shanghai', from: fridayMorning })
    assert.equal(new Date(nextWeekday!).toISOString(), '2026-08-31T00:00:00.000Z')
    console.log('Acquisition plan integration passed: recurring schedule, immediate run, overlap guard, automation safety downgrade, pause/resume and dashboard brief verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
