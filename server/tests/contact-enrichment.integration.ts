import assert from 'node:assert/strict'
import { createServer } from 'node:http'

process.env.SONDARA_ALLOW_PRIVATE_CONNECTORS = 'true'

const listen = (server: ReturnType<typeof createServer>) => new Promise<number>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', () => {
    const address = server.address()
    if (!address || typeof address === 'string') return reject(new Error('无法取得模拟官网端口'))
    resolve(address.port)
  })
})
const close = (server: ReturnType<typeof createServer>) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))

const run = async () => {
  const [{ eq }, { db }, schema, { createId }, { enrichCandidateContacts }] = await Promise.all([
    import('drizzle-orm'), import('../db/client.js'), import('../db/schema.js'), import('../lib/ids.js'), import('../radar/contact-enrichment.js'),
  ])
  const { users, workspaces, workspaceMembers, radarTasks, radarCandidates, candidateEvidence, candidateContacts } = schema
  const now = Date.now()
  const userId = createId('usr')
  const workspaceId = createId('wsp')
  const taskId = createId('rts')
  const candidateId = createId('can')
  let port = 0
  const mockServer = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url === '/contact') {
      response.end('<html><body><h1>Contact</h1><a href="mailto:procurement@contact.test">Procurement</a><a href="tel:+86 21 5555 6677">Call</a><a href="https://linkedin.com/company/contact-industries">LinkedIn</a></body></html>')
      return
    }
    response.end(`<html><head><title>Contact Industries</title></head><body><a href="http://127.0.0.1:${port}/contact">联系我们</a></body></html>`)
  })
  try {
    port = await listen(mockServer)
    db.transaction(tx => {
      tx.insert(users).values({ id: userId, email: `${userId}@integration.local`, passwordHash: 'integration-only', displayName: 'Contact integration', status: 'active', createdAt: now, updatedAt: now }).run()
      tx.insert(workspaces).values({ id: workspaceId, name: 'Contact integration', ownerUserId: userId, createdAt: now, updatedAt: now }).run()
      tx.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner', createdAt: now }).run()
      tx.insert(radarTasks).values({ id: taskId, workspaceId, name: 'Contact test', icp: '工业设备', status: 'completed', progress: 100, currentStage: '研究完成', ownerUserId: userId, createdAt: now, updatedAt: now }).run()
      tx.insert(radarCandidates).values({ id: candidateId, workspaceId, radarTaskId: taskId, company: 'Contact Industries', industry: '工业设备', score: 78, confidence: 60, committeeJson: '[]', relationshipsJson: '[]', discoveredAt: now, updatedAt: now }).run()
      tx.insert(candidateEvidence).values({ id: createId('evd'), workspaceId, candidateId, title: '企业官网', source: '模拟官网', observedLabel: '刚刚', strength: '中', sourceUrl: `http://127.0.0.1:${port}/`, createdAt: now }).run()
    })

    const first = await enrichCandidateContacts(workspaceId, candidateId)
    assert.ok(first)
    assert.equal(first.discovered, 3)
    assert.equal(first.pagesScanned, 2)
    assert.ok(first.contacts.some(item => item.email === 'procurement@contact.test' && item.role === '采购与供应链'))
    assert.ok(first.contacts.some(item => item.phone === '+86 21 5555 6677'))
    assert.ok(first.contacts.some(item => item.socialUrl?.includes('linkedin.com/company/contact-industries')))
    const stored = db.select().from(candidateContacts).where(eq(candidateContacts.candidateId, candidateId)).all()
    assert.equal(stored.length, 3)
    const candidate = db.select().from(radarCandidates).where(eq(radarCandidates.id, candidateId)).get()
    assert.ok(candidate)
    assert.match(candidate.committeeJson, /采购与供应链/)
    assert.ok(candidate.confidence > 60)

    const second = await enrichCandidateContacts(workspaceId, candidateId)
    assert.ok(second)
    assert.equal(second.discovered, 0)
    assert.equal(db.select().from(candidateContacts).where(eq(candidateContacts.candidateId, candidateId)).all().length, 3)
    console.log('Contact enrichment integration passed: public-page discovery, extraction, persistence and idempotency verified.')
  } finally {
    db.delete(users).where(eq(users.id, userId)).run()
    await close(mockServer).catch(() => undefined)
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
