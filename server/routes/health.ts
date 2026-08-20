import type { FastifyPluginAsync } from 'fastify'
import { sql } from 'drizzle-orm'
import { db, sqlite } from '../db/client.js'
import { config } from '../config.js'

const startTime = Date.now()

export const healthRoutes: FastifyPluginAsync = async app => {
  // Liveness — process is up, no DB check (survives transient DB issues)
  app.get('/healthz', async () => ({
    status: 'ok',
    service: 'sondara-api',
    version: config.version,
    time: new Date().toISOString(),
  }))

  // Readiness — DB reachable, workers status
  app.get('/ready', async (_request, reply) => {
    try {
      db.get(sql`select 1`)
      const walResult = sqlite.pragma('journal_mode', { simple: true }) as string
      return {
        status: 'ready',
        service: 'sondara-api',
        version: config.version,
        time: new Date().toISOString(),
        uptime: Math.round((Date.now() - startTime) / 1000),
        database: { connected: true, journalMode: walResult },
        workers: {
          radar: config.radarWorkerEnabled ? 'enabled' : 'disabled',
          outbox: config.outboxWorkerEnabled ? 'enabled' : 'disabled',
        },
      }
    } catch (error) {
      app.log.error({ err: error }, 'Readiness check failed')
      return reply.code(503).send({
        status: 'unavailable',
        service: 'sondara-api',
        time: new Date().toISOString(),
        database: { connected: false },
      })
    }
  })

  // Legacy /health — same as readiness
  app.get('/health', async (_request, reply) => {
    try {
      db.get(sql`select 1`)
      return {
        status: 'ok',
        service: 'sondara-api',
        version: config.version,
        time: new Date().toISOString(),
        uptime: Math.round((Date.now() - startTime) / 1000),
      }
    } catch (error) {
      app.log.error({ err: error }, 'Health check failed')
      return reply.code(503).send({
        status: 'error',
        service: 'sondara-api',
        time: new Date().toISOString(),
      })
    }
  })
}
