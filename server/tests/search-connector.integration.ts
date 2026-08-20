import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.SONDARA_ALLOW_PRIVATE_CONNECTORS = 'true'

const listen = (server: ReturnType<typeof createServer>) => new Promise<number>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('无法取得模拟搜索服务端口'))
    resolve(address.port)
  })
})
const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

const run = async () => {
  const [{ eq }, { db }, schema, { createId }, { encryptSecret }, { SearchDiscoveryConnector }, { assertSafeOutboundUrl }] = await Promise.all([
    import('drizzle-orm'), import('../db/client.js'), import('../db/schema.js'), import('../lib/ids.js'), import('../lib/secret-vault.js'), import('../radar/connectors/search-discovery.js'), import('../lib/url-safety.js'),
  ])
  const { users, workspaces, workspaceMembers, integrationConnections } = schema
  const now = Date.now()
  const userId = createId('usr')
  const workspaceId = createId('wsp')
  const connectionId = createId('int')
  let mockPort = 0
  const mockServer = createServer((request, response) => {
    if (request.url?.startsWith('/search')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ results: [{ title: 'Acme Industrial Equipment official website', url: `http://127.0.0.1:${mockPort}/company`, content: 'Industrial equipment manufacturer and service provider', engine: 'mock' }] }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><head><title>Acme Industrial Equipment</title><meta name="description" content="Industrial equipment manufacturer and service provider"></head><body><h1>Acme Industrial Equipment</h1></body></html>')
  })
  try {
    await assert.rejects(() => assertSafeOutboundUrl('http://127.0.0.1:8080', { label: '测试地址' }), /内网地址/)
    const port = await listen(mockServer)
    mockPort = port
    const encrypted = encryptSecret('integration-search-token')
    db.transaction(tx => {
      tx.insert(users).values({ id: userId, email: `${userId}@integration.local`, passwordHash: 'integration-only', displayName: 'Search integration', status: 'active', createdAt: now, updatedAt: now }).run()
      tx.insert(workspaces).values({ id: workspaceId, name: 'Search integration', ownerUserId: userId, createdAt: now, updatedAt: now }).run()
      tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner', createdAt: now }).run()
      tx.insert(integrationConnections).values({ id: connectionId, workspaceId, category: 'search', name: 'Local SearXNG mock', provider: 'searxng', endpoint: `http://127.0.0.1:${port}`, priority: 1, enabled: true, status: 'untested', secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretTag: encrypted.tag, secretEnding: 'OKEN', configJson: JSON.stringify({ resultLimit: 5 }), createdAt: now, updatedAt: now }).run()
    })
    const stored = db.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId)).get()
    assert.ok(stored?.secretCiphertext)
    assert.ok(!stored.secretCiphertext.includes('integration-search-token'))

    const connector = new SearchDiscoveryConnector()
    const task = { id: 'integration-task', workspaceId, name: 'Search integration', icp: 'industrial equipment', mode: '搜索引擎', depth: '标准研究', candidateLimit: 3, targetRegion: '全球', researchLanguage: '英语', seedUrls: [] }
    assert.equal(connector.supports(task), true)
    const progress: string[] = []
    const candidates = await connector.discover(task, message => progress.push(message))
    assert.equal(candidates.length, 1)
    assert.match(candidates[0].source, /搜索发现/)
    assert.ok(candidates[0].evidence.some(item => /SearXNG/.test(item.source)))
    assert.ok(progress.some(item => /搜索/.test(item)))
    console.log('Search connector integration passed: encrypted configuration, search discovery, website verification and SSRF default verified.')
  } finally {
    db.delete(users).where(eq(users.id, userId)).run()
    await close(mockServer).catch(() => undefined)
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
