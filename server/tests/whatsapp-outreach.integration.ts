import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { outboundChannelConnections, outboxJobs, users } from '../db/schema.js'

const run = async () => {
  const app = await buildApp()
  let userId = ''
  try {
    const register = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { displayName: 'WhatsApp 闭环测试', email: `whatsapp-${Date.now()}@integration.local`, password: 'WhatsApp@2026' },
    })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const cookie = register.headers['set-cookie']
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie! }

    const customer = await app.inject({
      method: 'POST', url: '/api/customers', headers,
      payload: { company: 'WhatsApp 目标客户', region: '德国', industry: '工业设备', score: 92, signal: '公开采购计划' },
    })
    assert.equal(customer.statusCode, 201, customer.body)
    const contact = await app.inject({
      method: 'POST', url: `/api/customers/${customer.json().id}/contacts`, headers,
      payload: { name: 'Anna Meyer', jobTitle: '采购经理', phone: '+49 151 0000 2026', primaryChannel: 'WhatsApp' },
    })
    assert.equal(contact.statusCode, 201, contact.body)
    const verified = await app.inject({
      method: 'POST', url: `/api/customers/${customer.json().id}/contacts/${contact.json().id}/verify`, headers,
      payload: { status: 'verified', source: '人工核验' },
    })
    assert.equal(verified.statusCode, 200, verified.body)
    const optedIn = await app.inject({
      method: 'POST', url: `/api/customers/${customer.json().id}/contacts/${contact.json().id}/whatsapp-opt-in`, headers,
      payload: { optedIn: true, source: '书面同意' },
    })
    assert.equal(optedIn.statusCode, 200, optedIn.body)

    const content = await app.inject({
      method: 'POST', url: '/api/content/assets', headers,
      payload: { title: 'WhatsApp 首次触达', contentType: '首次触达消息', channel: 'WhatsApp', body: 'Hello Anna, we noticed your public procurement plan. May I send a concise technical summary for review?', targetMarket: '德国工业设备', customerRole: '采购负责人', customerSignal: '公开采购计划' },
    })
    assert.equal(content.statusCode, 201, content.body)
    const connection = await app.inject({
      method: 'POST', url: '/api/outbox/connections', headers,
      payload: { name: 'WhatsApp 闭环连接', provider: 'whatsapp-cloud', host: 'https://graph.facebook.com/v23.0', port: 443, secure: true, username: 'phone-number-id', password: 'test-token', fromName: 'Growth Team', fromEmail: 'growth@example.com', whatsappBusinessAccountId: 'business-account-id', imapEnabled: false, priority: 1, enabled: true },
    })
    assert.equal(connection.statusCode, 201, connection.body)
    await db.update(outboundChannelConnections).set({ status: 'available', lastTestedAt: Date.now(), updatedAt: Date.now() }).where(eq(outboundChannelConnections.id, connection.json().id))
    const automationControl = await app.inject({ method: 'GET', url: '/api/radar/automation/control', headers })
    assert.equal(automationControl.statusCode, 200, automationControl.body)
    assert.equal(automationControl.json().readyToSend, true, automationControl.body)
    assert.deepEqual(automationControl.json().connections, { total: 1, healthy: 1, inboundReady: 1 })

    const campaign = await app.inject({
      method: 'POST', url: '/api/campaigns', headers,
      payload: { name: 'WhatsApp 授权客户触达', market: '德国', audienceLabel: '已授权采购联系人', channel: 'WhatsApp', stopRule: '收到回复', contentAssetId: content.json().id, audienceCustomerIds: [customer.json().id] },
    })
    assert.equal(campaign.statusCode, 201, campaign.body)
    const step = campaign.json().steps[0]
    const readiness = await app.inject({ method: 'GET', url: `/api/campaigns/${campaign.json().id}/steps/${step.id}/readiness`, headers })
    assert.equal(readiness.statusCode, 200, readiness.body)
    assert.equal(readiness.json().canExecute, true, readiness.body)
    assert.equal(readiness.json().reachableCount, 1)

    const execution = await app.inject({ method: 'POST', url: `/api/campaigns/${campaign.json().id}/steps/${step.id}/execute`, headers, payload: { confirmation: true } })
    assert.equal(execution.statusCode, 202, execution.body)
    assert.equal(execution.json().queued, 1, execution.body)
    assert.equal(execution.json().manualTasks ?? 0, 0)
    const job = await db.$first(db.select().from(outboxJobs).where(eq(outboxJobs.id, execution.json().jobIds[0])))
    assert.equal(job?.channel, 'WhatsApp')
    assert.equal(job?.connectionId, connection.json().id)
    console.log('WhatsApp outreach integration passed: verified contact, recorded consent, readiness and automated campaign queue verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(() => process.exit(0), error => { console.error(error); process.exit(1) })
