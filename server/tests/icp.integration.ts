import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { businessProfiles, knowledgeItems, users } from '../db/schema.js'

const run = async () => {
  const app = await buildApp()
  const email = `icp-${Date.now()}@integration.local`
  let userId = ''
  let workspaceId = ''
  try {
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: 'ICP 集成测试', email, password: 'Icp@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    workspaceId = register.json().workspace.id
    const cookie = register.headers['set-cookie']
    assert.ok(cookie)
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie }

    // GET profile auto-creates an empty row
    const empty = await app.inject({ method: 'GET', url: '/api/icp/profile', headers })
    assert.equal(empty.statusCode, 200, empty.body)
    assert.equal(empty.json().company, '')
    assert.equal(empty.json().analysisStatus, 'idle')

    // PUT profile
    const updated = await app.inject({
      method: 'PUT', url: '/api/icp/profile', headers,
      payload: {
        company: 'Sondara Industrial Solutions',
        website: 'https://example.com',
        products: '卫生级阀门、泵、管路系统及自动化解决方案',
        regions: '中国、德国、北美、东南亚',
        customers: '食品工厂、制药企业、乳品工程商和区域设备经销商',
        exclusions: '消费品公司',
        selectedMarket: '德国食品设备',
      },
    })
    assert.equal(updated.statusCode, 200, updated.body)
    assert.equal(updated.json().company, 'Sondara Industrial Solutions')
    assert.equal(updated.json().products.includes('阀门'), true)

    // PATCH via partial PUT (pickProvided) — only products
    const partial = await app.inject({
      method: 'PUT', url: '/api/icp/profile', headers,
      payload: { products: '卫生级阀门与控制系统' },
    })
    assert.equal(partial.statusCode, 200, partial.body)
    assert.equal(partial.json().products, '卫生级阀门与控制系统')
    assert.equal(partial.json().company, 'Sondara Industrial Solutions')

    // Analyze — no AI configured, should produce local-rules result
    const analyzed = await app.inject({ method: 'POST', url: '/api/icp/profile/analyze', headers })
    assert.equal(analyzed.statusCode, 202, analyzed.body)
    assert.equal(analyzed.json().mode, 'local-rules')
    assert.ok(Array.isArray(analyzed.json().analysis.recommendedMarkets))
    assert.equal(analyzed.json().analysis.recommendedMarkets.length, 10)
    assert.ok(analyzed.json().analysis.recommendedMarkets.every((market: { profile?: string[]; criteria?: string[]; signals?: string[] }) =>
      (market.profile?.length ?? 0) >= 4 && (market.criteria?.length ?? 0) >= 7 && (market.signals?.length ?? 0) >= 4))
    assert.equal(new Set(analyzed.json().analysis.recommendedMarkets.map((market: { criteria?: string[] }) => JSON.stringify(market.criteria))).size, 10)
    assert.equal(analyzed.json().analysisStatus, 'complete')
    assert.match(analyzed.json().analysisSummary, /recommendedMarkets/)

    // Create knowledge item
    const created = await app.inject({
      method: 'POST', url: '/api/icp/knowledge', headers,
      payload: {
        title: '卫生级流体设备解决方案',
        itemType: '产品与方案',
        summary: '覆盖食品、制药与乳品产线的卫生级阀门、泵与管路解决方案。',
        source: '内部资料 · 产品手册',
        tags: ['卫生级', '食品设备'],
        status: '已启用',
      },
    })
    assert.equal(created.statusCode, 201, created.body)
    const knowledgeId = created.json().id
    assert.deepEqual(created.json().tags, ['卫生级', '食品设备'])
    assert.equal(created.json().status, '已启用')

    // Validation error
    const invalid = await app.inject({
      method: 'POST', url: '/api/icp/knowledge', headers,
      payload: { itemType: '产品与方案' },
    })
    assert.equal(invalid.statusCode, 400)

    // List with type filter
    const list = await app.inject({ method: 'GET', url: '/api/icp/knowledge?itemType=产品与方案&pageSize=20', headers })
    assert.equal(list.statusCode, 200, list.body)
    assert.ok(list.json().total >= 1)
    assert.ok(list.json().items.every((item: { itemType: string }) => item.itemType === '产品与方案'))

    // Search by tag
    const search = await app.inject({ method: 'GET', url: '/api/icp/knowledge?q=食品设备', headers })
    assert.equal(search.statusCode, 200)
    assert.ok(search.json().total >= 1)

    // PATCH knowledge
    const patched = await app.inject({
      method: 'PATCH', url: `/api/icp/knowledge/${knowledgeId}`, headers,
      payload: { summary: '更新后的摘要。', tags: ['卫生级', '阀门'] },
    })
    assert.equal(patched.statusCode, 200, patched.body)
    assert.equal(patched.json().summary, '更新后的摘要。')
    assert.deepEqual(patched.json().tags, ['卫生级', '阀门'])

    // PATCH status
    const statusChange = await app.inject({
      method: 'PATCH', url: `/api/icp/knowledge/${knowledgeId}/status`, headers,
      payload: { status: '已停用' },
    })
    assert.equal(statusChange.statusCode, 200)
    assert.equal(statusChange.json().status, '已停用')

    // Invalid status
    const badStatus = await app.inject({
      method: 'PATCH', url: `/api/icp/knowledge/${knowledgeId}/status`, headers,
      payload: { status: 'invalid' },
    })
    assert.equal(badStatus.statusCode, 400)

    // Create a second item, test filter by status
    await app.inject({
      method: 'POST', url: '/api/icp/knowledge', headers,
      payload: { title: 'GMP 扩产信号', itemType: '市场知识', summary: 'GMP 扩产带来设备采购窗口。', tags: ['GMP'], status: '待复核' },
    })
    const disabled = await app.inject({ method: 'GET', url: '/api/icp/knowledge?status=已停用', headers })
    assert.equal(disabled.json().total, 1)
    const pending = await app.inject({ method: 'GET', url: '/api/icp/knowledge?status=待复核', headers })
    assert.equal(pending.json().total, 1)

    // Cross-workspace isolation
    const otherRegister = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: '其他账号', email: `other-${Date.now()}@integration.local`, password: 'Icp@2026' } })
    const otherCookie = otherRegister.headers['set-cookie']
    const otherHeaders = { cookie: Array.isArray(otherCookie) ? otherCookie[0] : otherCookie }
    const otherProfile = await app.inject({ method: 'GET', url: '/api/icp/profile', headers: otherHeaders })
    assert.equal(otherProfile.json().company, '')
    const otherKnowledge = await app.inject({ method: 'GET', url: '/api/icp/knowledge', headers: otherHeaders })
    assert.equal(otherKnowledge.json().total, 0)

    // Cross-workspace PATCH returns 404
    const crossPatch = await app.inject({
      method: 'PATCH', url: `/api/icp/knowledge/${knowledgeId}`, headers: otherHeaders,
      payload: { summary: 'hacked' },
    })
    assert.equal(crossPatch.statusCode, 404)

    // Delete
    const removed = await app.inject({ method: 'DELETE', url: `/api/icp/knowledge/${knowledgeId}`, headers })
    assert.equal(removed.statusCode, 204)
    const missing = await app.inject({ method: 'GET', url: `/api/icp/knowledge/${knowledgeId}`, headers })
    assert.equal(missing.statusCode, 404)

    // Unauthenticated access returns 401
    const unauth = await app.inject({ method: 'GET', url: '/api/icp/profile' })
    assert.equal(unauth.statusCode, 401)

    assert.ok((await db.$first(db.select().from(businessProfiles).where(eq(businessProfiles.workspaceId, workspaceId)))))
    console.log('ICP integration passed: profile upsert, analyze, knowledge CRUD, filtering and workspace isolation verified.')
  } finally {
    if (userId) {
      await db.delete(knowledgeItems).where(eq(knowledgeItems.workspaceId, workspaceId))
      await db.delete(businessProfiles).where(eq(businessProfiles.workspaceId, workspaceId))
      await db.delete(users).where(eq(users.id, userId))
    }
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
