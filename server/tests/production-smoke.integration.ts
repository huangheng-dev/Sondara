import assert from 'node:assert/strict'
import { buildApp } from '../app.js'

const run = async () => {
  const app = await buildApp()
  try {
    const health = await app.inject({ method: 'GET', url: '/api/healthz' })
    assert.equal(health.statusCode, 200, health.body)
    assert.equal(health.json().status, 'ok')

    const ready = await app.inject({ method: 'GET', url: '/api/ready' })
    assert.equal(ready.statusCode, 200, ready.body)
    assert.equal(ready.json().status, 'ready')
    assert.equal(ready.json().database.connected, true)

    const home = await app.inject({ method: 'GET', url: '/' })
    assert.equal(home.statusCode, 200, home.body)
    assert.match(home.body, /<div id="root"><\/div>/)
    const assetUrls = Array.from(home.body.matchAll(/(?:href|src)="(\/assets\/[^"]+)"/g)).map(match => match[1])
    assert.ok(assetUrls.length >= 4, 'production HTML should reference built CSS and JS assets')
    for (const assetUrl of assetUrls) {
      const asset = await app.inject({ method: 'GET', url: assetUrl })
      assert.equal(asset.statusCode, 200, `${assetUrl}: ${asset.body}`)
      assert.ok(asset.headers['content-type'], `${assetUrl} should have a content type`)
    }

    const spaFallback = await app.inject({ method: 'GET', url: '/settings/security' })
    assert.equal(spaFallback.statusCode, 200, spaFallback.body)
    assert.match(spaFallback.body, /<div id="root"><\/div>/)

    const missingApi = await app.inject({ method: 'GET', url: '/api/not-found' })
    assert.equal(missingApi.statusCode, 404, missingApi.body)
    assert.equal(missingApi.json().error, 'NOT_FOUND')

    console.log('Production smoke integration passed: health, readiness, static assets, SPA fallback and API 404 verified.')
  } finally {
    await app.close()
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})