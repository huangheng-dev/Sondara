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
  const goodServiceId = createId('ais')
  const failedKeyId = createId('aik')
  const goodKeyId = createId('aik')
  const responsesServiceId = createId('ais')
  const anthropicServiceId = createId('ais')
  let failedCalls = 0
  let goodCalls = 0
  let responsesCalls = 0
  let anthropicCalls = 0
  const server = createServer((request, response) => {
    const authorization = request.headers.authorization
    if (authorization === 'Bearer fake-fail-key') {
      failedCalls += 1
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: 'invalid test credential' } }))
      return
    }
    if (request.url?.endsWith('/responses')) {
      responsesCalls += 1
      assert.equal(request.headers.authorization, 'Bearer responses-key')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'RESPONSES_OK' }] }] }))
      return
    }
    if (request.url?.endsWith('/messages')) {
      anthropicCalls += 1
      assert.equal(request.headers['x-api-key'], 'anthropic-key')
      assert.equal(request.headers['anthropic-version'], '2023-06-01')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ content: [{ type: 'text', text: 'ANTHROPIC_OK' }] }))
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
    await db.transaction(async tx => {
            await tx.insert(users).values({ id: userId, email: `${userId}@integration.local`, passwordHash: 'integration-only', displayName: 'AI integration', status: 'active', createdAt: now, updatedAt: now })
            await tx.insert(workspaces).values({ id: workspaceId, name: 'AI integration', ownerUserId: userId, createdAt: now, updatedAt: now })
            await tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner', createdAt: now })
            await tx.insert(workspaceAiPolicies).values({ workspaceId, rotationStrategy: 'failover', retryCount: 2, retryBackoff: 'fixed', retryDelayMs: 1, cooldownMs: 300_000, failoverEnabled: true, updatedAt: now })
            await tx.insert(aiServices).values([
              { id: serviceId, workspaceId, name: 'Failing model connection', provider: 'openai-compatible', model: 'mock-model', endpoint: `http://127.0.0.1:${port}`, priority: 1, enabled: true, status: 'untested', createdAt: now, updatedAt: now },
              { id: goodServiceId, workspaceId, name: 'Good model connection', provider: 'openai-compatible', model: 'mock-model', endpoint: `http://127.0.0.1:${port}`, priority: 2, enabled: true, status: 'untested', createdAt: now + 1, updatedAt: now + 1 },
              { id: responsesServiceId, workspaceId, name: 'Responses model connection', provider: 'openai-compatible', protocol: 'openai-responses', model: 'mock-responses', endpoint: `http://127.0.0.1:${port}`, priority: 3, enabled: true, status: 'untested', createdAt: now + 2, updatedAt: now + 2 },
              { id: anthropicServiceId, workspaceId, name: 'Anthropic model connection', provider: 'openai-compatible', protocol: 'anthropic-messages', model: 'mock-anthropic', endpoint: `http://127.0.0.1:${port}/v1`, priority: 4, enabled: true, status: 'untested', createdAt: now + 3, updatedAt: now + 3 },
            ])
            const failed = encryptSecret('fake-fail-key')
            const good = encryptSecret('integration-good-key')
            const responses = encryptSecret('responses-key')
            const anthropic = encryptSecret('anthropic-key')
            await tx.insert(aiServiceKeys).values([
                      { id: failedKeyId, workspaceId, serviceId, name: 'failing', secretCiphertext: failed.ciphertext, secretIv: failed.iv, secretTag: failed.tag, ending: 'FAIL', enabled: true, failureCount: 0, createdAt: now, updatedAt: now },
                      { id: goodKeyId, workspaceId, serviceId: goodServiceId, name: 'good', secretCiphertext: good.ciphertext, secretIv: good.iv, secretTag: good.tag, ending: 'GOOD', enabled: true, failureCount: 0, createdAt: now + 1, updatedAt: now + 1 },
                      { id: createId('aik'), workspaceId, serviceId: responsesServiceId, name: 'responses', secretCiphertext: responses.ciphertext, secretIv: responses.iv, secretTag: responses.tag, ending: 'NSES', enabled: true, failureCount: 0, createdAt: now + 2, updatedAt: now + 2 },
                      { id: createId('aik'), workspaceId, serviceId: anthropicServiceId, name: 'anthropic', secretCiphertext: anthropic.ciphertext, secretIv: anthropic.iv, secretTag: anthropic.tag, ending: 'OPIC', enabled: true, failureCount: 0, createdAt: now + 3, updatedAt: now + 3 },
                    ])
          })

    const first = await completeWithAi({ workspaceId, messages: [{ role: 'user', content: 'integration' }] })
    assert.equal(first.serviceId, goodServiceId)
    assert.equal(failedCalls, 3)
    assert.equal(goodCalls, 1)
    const failedKey = (await db.$first(db.select().from(aiServiceKeys).where(eq(aiServiceKeys.id, failedKeyId))))
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
    const responsesResult = await completeWithAi({ workspaceId, serviceId: responsesServiceId, messages: [{ role: 'user', content: 'responses' }] })
    assert.equal(responsesResult.content, 'RESPONSES_OK')
    assert.equal(responsesCalls, 1)
    const anthropicResult = await completeWithAi({ workspaceId, serviceId: anthropicServiceId, messages: [{ role: 'system', content: 'system' }, { role: 'user', content: 'anthropic' }] })
    assert.equal(anthropicResult.content, 'ANTHROPIC_OK')
    assert.equal(anthropicCalls, 1)
    console.log('AI client integration passed: all three API protocols, retry policy, model-connection failover, cooldown and structured enrichment verified.')
  } finally {
    await db.delete(users).where(eq(users.id, userId))
    await close(server).catch(() => undefined)
  }
}

run().then(
  () => process.exit(0),
  error => { console.error(error); process.exit(1) },
)
