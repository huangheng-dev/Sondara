import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.SONDARA_ALLOW_PRIVATE_CONNECTORS = 'true'

const listen = (server: ReturnType<typeof createServer>) => new Promise<number>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('无法取得模拟地图服务端口'))
    resolve(address.port)
  })
})
const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

const run = async () => {
  const [{ eq }, { db }, schema, { createId }, { encryptSecret }, { MapDiscoveryConnector }, { assertSafeOutboundUrl }] = await Promise.all([
    import('drizzle-orm'), import('../db/client.js'), import('../db/schema.js'), import('../lib/ids.js'), import('../lib/secret-vault.js'), import('../radar/connectors/map-discovery.js'), import('../lib/url-safety.js'),
  ])
  const { users, workspaces, workspaceMembers, integrationConnections } = schema
  const now = Date.now()
  const userId = createId('usr')
  const workspaceId = createId('wsp')
  const connectionId = createId('int')
  let receivedKey = ''
  let receivedQuery = ''
  const mockServer = createServer((request, response) => {
    receivedKey = String(request.headers['x-goog-api-key'] ?? '')
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { textQuery?: string }
      receivedQuery = body.textQuery ?? ''
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ places: [{
        id: 'mock-place-1',
        displayName: { text: '常州优创制药设备' },
        formattedAddress: '江苏省常州市新北区工业园',
        location: { latitude: 31.81, longitude: 119.97 },
        types: ['industrial_equipment_supplier', 'point_of_interest'],
        websiteUri: 'https://example.com/',
        nationalPhoneNumber: '0519-12345678',
        businessStatus: 'OPERATIONAL',
        googleMapsUri: 'https://maps.google.com/?cid=mock-place-1',
      }] }))
    })
  })
  try {
    await assert.rejects(() => assertSafeOutboundUrl('http://127.0.0.1:8080', { label: '测试地址' }), /内网地址/)
    const port = await listen(mockServer)
    const encrypted = encryptSecret('integration-map-token')
    db.transaction(tx => {
      tx.insert(users).values({ id: userId, email: `${userId}@integration.local`, passwordHash: 'integration-only', displayName: 'Map integration', status: 'active', createdAt: now, updatedAt: now }).run()
      tx.insert(workspaces).values({ id: workspaceId, name: 'Map integration', ownerUserId: userId, createdAt: now, updatedAt: now }).run()
      tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner', createdAt: now }).run()
      tx.insert(integrationConnections).values({ id: connectionId, workspaceId, category: 'map', name: 'Local Google Places mock', provider: 'google-places', endpoint: `http://127.0.0.1:${port}/v1/places:searchText`, priority: 1, enabled: true, status: 'untested', secretCiphertext: encrypted.ciphertext, secretIv: encrypted.iv, secretTag: encrypted.tag, secretEnding: 'OKEN', configJson: JSON.stringify({ resultLimit: 5 }), createdAt: now, updatedAt: now }).run()
    })
    const stored = db.select().from(integrationConnections).where(eq(integrationConnections.id, connectionId)).get()
    assert.ok(stored?.secretCiphertext)
    assert.ok(!stored.secretCiphertext.includes('integration-map-token'))

    const connector = new MapDiscoveryConnector()
    const task = { id: 'integration-task', workspaceId, name: 'Map integration', icp: '制药设备', mode: '地图找客', depth: '标准研究', candidateLimit: 3, targetRegion: '常州', researchLanguage: '中文', seedUrls: [] }
    assert.equal(connector.supports(task), true)
    const progress: string[] = []
    const candidates = await connector.discover(task, message => progress.push(message))
    assert.equal(receivedKey, 'integration-map-token')
    assert.match(receivedQuery, /制药设备/)
    assert.match(receivedQuery, /常州/)
    assert.equal(candidates.length, 1)
    assert.equal(candidates[0].company, '常州优创制药设备')
    assert.match(candidates[0].source, /Google Places/)
    assert.ok(candidates[0].relationships.some(item => item.label === '企业官网'))
    assert.ok(candidates[0].relationships.some(item => item.label === '地图坐标'))
    assert.ok(progress.some(item => /地图/.test(item)))
    console.log('Map connector integration passed: encrypted configuration, place discovery, map evidence and SSRF default verified.')
  } finally {
    db.delete(users).where(eq(users.id, userId)).run()
    await close(mockServer).catch(() => undefined)
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
