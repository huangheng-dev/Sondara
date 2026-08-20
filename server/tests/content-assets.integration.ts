import assert from 'node:assert/strict'
import { eq } from 'drizzle-orm'
import { buildApp } from '../app.js'
import { db } from '../db/client.js'
import { contentGenerationRuns, contentQualityChecks, contentVersions, users } from '../db/schema.js'

const run = async () => {
  const app = await buildApp()
  const email = `content-${Date.now()}@integration.local`
  let userId = ''
  try {
    const register = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { displayName: '内容集成测试', email, password: 'Content@2026' } })
    assert.equal(register.statusCode, 201, register.body)
    userId = register.json().user.id
    const cookie = register.headers['set-cookie']
    assert.ok(cookie)
    const headers = { cookie: Array.isArray(cookie) ? cookie[0] : cookie }

    const created = await app.inject({ method: 'POST', url: '/api/content/assets', headers, payload: { title: '工业设备验证邮件', contentType: '首次触达邮件', channel: '邮件', language: '中文', body: '您好，我们为工业设备采购负责人整理了 3 个验证案例。如果相关，可以回复本邮件获取两页清单。', targetMarket: '工业设备', customerRole: '采购负责人', buyingStage: '方案比较', customerSignal: '新建产线', sourceMethod: '客户信号' } })
    assert.equal(created.statusCode, 201, created.body)
    const asset = created.json()
    assert.equal(asset.currentVersion, 1)
    assert.ok(asset.qualityScore > 0)

    const updated = await app.inject({ method: 'PATCH', url: `/api/content/assets/${asset.id}`, headers, payload: { body: `${asset.body}\n\n我们建议在 48 小时内确认技术参数。`, changeNote: '补充时间动作' } })
    assert.equal(updated.statusCode, 200, updated.body)
    assert.equal(updated.json().currentVersion, 2)
    assert.equal(updated.json().contentType, '首次触达邮件')
    assert.equal(updated.json().targetMarket, '工业设备')

    const versions = await app.inject({ method: 'GET', url: `/api/content/assets/${asset.id}/versions`, headers })
    assert.equal(versions.statusCode, 200, versions.body)
    assert.deepEqual(versions.json().items.map((item: { versionNumber: number }) => item.versionNumber), [2, 1])

    const quality = await app.inject({ method: 'POST', url: `/api/content/assets/${asset.id}/quality-check`, headers })
    assert.equal(quality.statusCode, 200, quality.body)
    assert.ok(quality.json().findings.length >= 1)

    const generated = await app.inject({ method: 'POST', url: '/api/content/generate', headers, payload: { title: '德国食品设备跟进邮件', contentType: '跟进邮件', channel: '邮件', language: '中文', targetMarket: '德国食品设备', customerRole: '采购负责人', buyingStage: '问题认知', customerSignal: '产品线扩张', sourceMethod: '客户信号', saveAsAsset: true } })
    assert.equal(generated.statusCode, 200, generated.body)
    assert.equal(generated.json().generationMode, 'local-rules')
    assert.ok(generated.json().assetId)
    assert.match(generated.json().body, /产品线扩张/)

    const refined = await app.inject({ method: 'POST', url: '/api/content/generate', headers, payload: { title: '润色工业设备邮件', contentType: '邮件润色', channel: '邮件', language: '中文', targetMarket: '工业设备', customerRole: '采购负责人', buyingStage: '方案比较', customerSignal: '新建产线', sourceMethod: '编辑器润色', existingBody: '如果这与您当前的产品规划相关，我们可以介绍案例。' } })
    assert.equal(refined.statusCode, 200, refined.body)
    assert.match(refined.json().body, /如果该方向符合贵司当前规划/)
    assert.match(refined.json().body, /回复/)

    const analyzed = await app.inject({ method: 'POST', url: '/api/content/analyze', headers, payload: { title: '语言检查', contentType: '首次触达邮件', language: '中文', body: asset.body, targetMarket: '工业设备', customerRole: '采购负责人', buyingStage: '方案比较', customerSignal: '新建产线' } })
    assert.equal(analyzed.statusCode, 200, analyzed.body)
    assert.equal(analyzed.json().tips.length, 3)
    assert.ok(analyzed.json().quality.overallScore > 0)

    const duplicate = await app.inject({ method: 'POST', url: `/api/content/assets/${asset.id}/duplicate`, headers })
    assert.equal(duplicate.statusCode, 201, duplicate.body)
    assert.match(duplicate.json().title, /副本/)

    const listed = await app.inject({ method: 'GET', url: '/api/content/assets?q=工业设备&pageSize=20', headers })
    assert.equal(listed.statusCode, 200, listed.body)
    assert.ok(listed.json().total >= 2)
    assert.ok((await db.select().from(contentVersions).where(eq(contentVersions.contentAssetId, asset.id))).length >= 2)
    assert.ok((await db.select().from(contentQualityChecks).where(eq(contentQualityChecks.contentAssetId, asset.id))).length >= 2)
    assert.ok((await db.$first(db.select().from(contentGenerationRuns).where(eq(contentGenerationRuns.contentAssetId, generated.json().assetId)))))
    console.log('Content assets integration passed: CRUD, versions, quality checks, generation records and duplication verified.')
  } finally {
    if (userId) await db.delete(users).where(eq(users.id, userId))
    await app.close()
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
