import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { completeWithAi } from '../ai/client.js'
import { db } from '../db/client.js'
import { aiServiceKeys, aiServices, users, workspaceAiPolicies, workspaceMembers, workspaces } from '../db/schema.js'
import { createId } from '../lib/ids.js'
import { encryptSecret } from '../lib/secret-vault.js'
import { enrichCandidateWithAi } from '../radar/ai-enrichment.js'

const listen = (server: ReturnType<typeof createServer>) => new Promise<number>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('无法取得模拟服务端口'))
    resolve(address.port)
  })
})

const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

const run = async () => {
  const now = Date.now()
  const userId = createId('usr')
  const workspaceId = createId('wsp')
  const serviceId = createId('ais')
  const failedKeyId = createId('aik')
  const goodKeyId = createId('aik')
  let failedCalls = 0
  let goodCalls = 0
  const server = createServer((request, response) => {
    const authorization = request.headers.authorization
    if (authorization === 'Bearer fake-fail-key') {
      failedCalls += 1
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid test credential' } }))
      return
    }
    goodCalls += 1
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      industry: '工业设备', signal: '官网产品信息与目标客户定位相关', reason: '仅依据官网公开标题和描述判断，购买时机待验证。',
      score: 82, confidence: 76,
      dimensions: [{ label: '定位相关度', score: 82 }, { label: '证据可信度', score: 78 }, { label: '购买时机', score: 35 }, { label: '资料完整度', score: 70 }],
    }) } }] }))
  })

  try {
    const port = await listen(server)
    db.transaction(tx => {
      tx.insert(users).values({ id: userId, email: `${userId}@integration.local`, passwordHash: 'integration-only', displayName: 'AI integration', status: 'active', createdAt: now, updatedAt: now }).run()
      tx.insert(workspaces).values({ id: workspaceId, name: 'AI integration', ownerUserId: userId, createdAt: now, updatedAt: now }).run()
      tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner', createdAt: now }).run()
      tx.insert(workspaceAiPolicies).values({ workspaceId, rotationStrategy: 'failover', retryCount: 2, retryBackoff: 'fixed', retryDelayMs: 1, cooldownMs: 300_000, failoverEnabled: true, updatedAt: now }).run()
      tx.insert(aiServices).values({ id: serviceId, workspaceId, name: 'Local mock', provider: 'openai-compatible', model: 'mock-model', endpoint: `http://127.0.0.1:${port}`, priority: 1, enabled: true, status: 'untested', createdAt: now, updatedAt: now }).run()
      const failed = encryptSecret('fake-fail-key')
      const good = encryptSecret('integration-good-key')
      tx.insert(aiServiceKeys).values([
        { id: failedKeyId, workspaceId, serviceId, name: 'failing', secretCiphertext: failed.ciphertext, secretIv: failed.iv, secretTag: failed.tag, ending: 'FAIL', enabled: true, failureCount: 0, createdAt: now, updatedAt: now },
        { id: goodKeyId, workspaceId, serviceId, name: 'good', secretCiphertext: good.ciphertext, secretIv: good.iv, secretTag: good.tag, ending: 'GOOD', enabled: true, failureCount: 0, createdAt: now + 1, updatedAt: now + 1 },
      ]).run()
    })

    const first = await completeWithAi({ workspaceId, messages: [{ role: 'user', content: 'integration' }] })
    assert.equal(first.serviceId, serviceId)
    assert.equal(failedCalls, 3)
    assert.equal(goodCalls, 1)
    const failedKey = db.select().from(aiServiceKeys).where(eq(aiServiceKeys.id, failedKeyId)).get()
    assert.equal(failedKey?.failureCount, 1)
    assert.ok((failedKey?.cooldownUntil ?? 0) > Date.now())

    await completeWithAi({ workspaceId, messages: [{ role: 'user', content: 'integration second call' }] })
    assert.equal(failedCalls, 3, '处于冷却期的密钥不应立即重试')
    assert.equal(goodCalls, 2)

    const enrichment = await enrichCandidateWithAi({ id: 'task', workspaceId, name: 'test', icp: '工业设备', mode: '官网', depth: '标准研究', candidateLimit: 1, targetRegion: '全球', researchLanguage: '中文', seedUrls: ['https://example.com'] }, {
      company: 'Example Industries', region: '全球', industry: '待验证', size: '待补全', score: 60, signal: '官网可访问', source: '企业官网', estimatedValue: 0, currency: 'CNY', confidence: 60,
      reason: '官网公开页面可访问', dimensions: [], evidence: [{ title: 'Example', source: 'example.com', time: new Date().toISOString(), strength: '中', sourceUrl: 'https://example.com' }], committee: [], relationships: [],
    })
    assert.equal(enrichment.candidate.industry, '工业设备')
    assert.equal(enrichment.candidate.score, 82)
    assert.equal(goodCalls, 3)
    console.log('AI client integration passed: retry policy, key failover, cooldown and structured enrichment verified.')
  } finally {
    db.delete(users).where(eq(users.id, userId)).run()
    await close(server).catch(() => undefined)
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
