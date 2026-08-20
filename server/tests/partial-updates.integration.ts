import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

const run = async () => {
  const app = await buildApp()
  const email = `partial-${Date.now()}@integration.local`
  let userId = ''
  try {
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: '局部更新测试', email, password: 'Partial@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const cookie = register.headers['set-cookie']
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : String(cookie) }

    const customer = await app.inject({ method: 'POST', url: '/api/customers', headers, payload: { company: '局部更新客户', region: '德国', industry: '食品设备', score: 91, source: '集成测试' } })
    const customerUpdate = await app.inject({ method: 'PATCH', url: `/api/customers/${customer.json().id}`, headers, payload: { stage: '重点跟进' } })
    assert.equal(customerUpdate.statusCode, 200, customerUpdate.body)
    assert.equal(customerUpdate.json().region, '德国')
    assert.equal(customerUpdate.json().score, 91)

    const task = await app.inject({ method: 'POST', url: '/api/tasks', headers, payload: { customerId: customer.json().id, title: '保留任务字段', priority: '高', company: '局部更新客户', nextAction: '准备方案' } })
    const taskUpdate = await app.inject({ method: 'PATCH', url: `/api/tasks/${task.json().id}`, headers, payload: { status: 'completed' } })
    assert.equal(taskUpdate.statusCode, 200, taskUpdate.body)
    assert.equal(taskUpdate.json().title, '保留任务字段')
    assert.equal(taskUpdate.json().priority, '高')

    const deal = await app.inject({ method: 'POST', url: '/api/deals', headers, payload: { customerId: customer.json().id, company: '局部更新客户', stage: '线索确认', valueAmount: 360000, currency: 'CNY', source: '客户消息' } })
    const dealUpdate = await app.inject({ method: 'PATCH', url: `/api/deals/${deal.json().id}`, headers, payload: { stage: '需求确认' } })
    assert.equal(dealUpdate.statusCode, 200, dealUpdate.body)
    assert.equal(dealUpdate.json().valueAmount, 360000)
    assert.equal(dealUpdate.json().source, '客户消息')
    console.log('Partial update integration passed: customer, task and deal fields are preserved.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
