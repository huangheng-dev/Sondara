import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.SONDARA_ALLOW_PRIVATE_CONNECTORS = 'true'

const fetchBlockedPorts = new Set([1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080])
const listen = (server: ReturnType<typeof createServer>): Promise<number> => new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('无法取得模拟行业来源端口'))
    if (address.port < 1024 || fetchBlockedPorts.has(address.port)) {
      server.close(error => error ? reject(error) : listen(server).then(resolve, reject))
      return
    }
    resolve(address.port)
  })
})
const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

const run = async () => {
  const [{ eq }, { db }, schema, { createId }, { IndustrySourceConnector, extractIndustryEntities }] = await Promise.all([
    import('drizzle-orm'), import('../db/client.js'), import('../db/schema.js'), import('../lib/ids.js'), import('../radar/connectors/industry-source.js'),
  ])
  const { users, workspaces, workspaceMembers, integrationConnections } = schema
  const now = Date.now()
  const userId = createId('usr')
  const workspaceId = createId('wsp')
  const connectionId = createId('int')
  let port = 0
  const mockServer = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
    if (url.pathname === '/search') {
      const query = url.searchParams.get('q') ?? ''
      const path = /tender|procurement/.test(query) ? '/tender' : /exhibitors|association/.test(query) ? '/association' : '/directory'
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ results: [{ title: '工业设备公开来源', url: `http://127.0.0.1:${port}${path}`, content: '公开企业与项目来源', engine: 'mock-industry' }] }))
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (url.pathname === '/directory') {
      response.end('<html><head><title>工业设备企业名录</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"常州精工设备有限公司","url":"https://example.com","address":{"addressLocality":"常州","addressRegion":"江苏","addressCountry":"中国"}}</script></head><body><a href="/member/shanghai-flow">上海流体科技有限公司</a></body></html>')
      return
    }
    if (url.pathname === '/association') {
      response.end('<html><head><title>行业协会会员名单</title></head><body><a href="/members/nordwerk">NordWerk Process GmbH</a></body></html>')
      return
    }
    response.end('<html><head><title>公开采购结果公告</title></head><body>项目采购结果：中标人：华东泵业有限公司。中标金额：120 万元。</body></html>')
  })
  try {
    port = await listen(mockServer)
    await db.transaction(async tx => {
            await tx.insert(users).values({ id: userId, email: `${userId}@integration.local`, passwordHash: 'integration-only', displayName: 'Industry integration', status: 'active', createdAt: now, updatedAt: now })
            await tx.insert(workspaces).values({ id: workspaceId, name: 'Industry integration', ownerUserId: userId, createdAt: now, updatedAt: now })
            await tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner', createdAt: now })
            await tx.insert(integrationConnections).values({ id: connectionId, workspaceId, category: 'search', name: 'Local industry search', provider: 'searxng', endpoint: `http://127.0.0.1:${port}`, priority: 1, enabled: true, status: 'untested', configJson: JSON.stringify({ resultLimit: 10 }), createdAt: now, updatedAt: now })
          })
    assert.equal((await fetch(`http://127.0.0.1:${port}/search?q=probe&format=json`)).status, 200)

    const structured = extractIndustryEntities('<script type="application/ld+json">{"@type":"Organization","name":"测试制造有限公司","url":"https://example.com"}</script>', new URL(`http://127.0.0.1:${port}/directory`), '行业名录')
    assert.equal(structured[0]?.name, '测试制造有限公司')
    assert.equal(structured[0]?.extraction, 'structured')

    const connector = new IndustrySourceConnector()
    const base = { id: 'task', workspaceId, name: 'Industry test', icp: '工业设备', depth: '标准研究', candidateLimit: 10, targetRegion: '华东', researchLanguage: '中文', seedUrls: [] }
    const directory = await connector.discover({ ...base, mode: '行业名录' }, () => undefined)
    assert.ok(directory.some(item => item.company === '常州精工设备有限公司'))
    assert.ok(directory.some(item => item.company === '上海流体科技有限公司'))
    assert.ok(directory.every(item => item.source === '行业目录'))
    assert.ok(directory.some(item => item.evidence[0]?.strength === '强'))

    const association = await connector.discover({ ...base, mode: '展会协会' }, () => undefined)
    assert.equal(association[0]?.company, 'NordWerk Process GmbH')
    assert.equal(association[0]?.source, '展会协会')

    const tender = await connector.discover({ ...base, mode: '招投标项目' }, () => undefined)
    assert.equal(tender[0]?.company, '华东泵业有限公司')
    assert.equal(tender[0]?.source, '公开招投标')
    assert.match(tender[0]?.signal ?? '', /采购|中标/)
    console.log('Industry source integration passed: directory, association and tender evidence discovery verified.')
  } finally {
    await db.delete(users).where(eq(users.id, userId))
    await close(mockServer).catch(() => undefined)
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
