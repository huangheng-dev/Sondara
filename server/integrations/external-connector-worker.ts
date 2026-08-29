import { and, asc, eq, lte } from 'drizzle-orm'
import { config } from '../config.js'
import { db } from '../db/client.js'
import { externalConnectorConfigurations } from '../db/schema.js'
import { acquireLeaderLease, LEADER_KEYS, type LeaderLease } from '../lib/leader-lock.js'
import { logger } from '../logger.js'
import { runConfiguredExternalConnector } from './external-connector-service.js'

export const processDueExternalConnectors = async (now = Date.now()) => {
  const due = await db.select().from(externalConnectorConfigurations).where(and(eq(externalConnectorConfigurations.enabled, true), eq(externalConnectorConfigurations.scheduleEnabled, true), lte(externalConnectorConfigurations.nextRunAt, now))).orderBy(asc(externalConnectorConfigurations.nextRunAt)).limit(5)
  let processed = 0
  for (const configuration of due) {
    try { await runConfiguredExternalConnector({ configuration, scheduled: true }); processed += 1 }
    catch (error) { logger.warn({ err: error, connectorKey: configuration.connectorKey, configurationId: configuration.id }, 'Scheduled external connector run failed') }
  }
  return processed
}

export const createExternalConnectorWorker = (intervalMs = config.externalConnectorWorkerIntervalMs) => {
  let timer: NodeJS.Timeout | null = null; let electionTimer: NodeJS.Timeout | null = null; let lease: LeaderLease | null = null; let running = false
  const tick = async () => { if (running) return; running = true; try { await processDueExternalConnectors() } catch (error) { logger.error({ err: error }, 'External connector worker tick failed') } finally { running = false } }
  const scheduleElection = () => { if (electionTimer) return; electionTimer = setTimeout(() => { electionTimer = null; void elect() }, config.workerLeaderElectionIntervalMs); electionTimer.unref?.() }
  const activate = () => { if (timer) return; void tick(); timer = setInterval(() => void tick(), intervalMs); timer.unref?.(); logger.info({ intervalMs }, 'External connector worker elected as leader') }
  const elect = async () => {
    if (timer || electionTimer) return
    if (!config.workerLeaderLock) { activate(); return }
    try {
      lease = await acquireLeaderLease(LEADER_KEYS.externalConnectors, () => { if (timer) clearInterval(timer); timer = null; void lease?.release(); lease = null; scheduleElection() })
      if (lease) activate(); else scheduleElection()
    } catch (error) { logger.warn({ err: error }, 'External connector worker leader election failed'); scheduleElection() }
  }
  return { start: elect, async stop() { if (electionTimer) clearTimeout(electionTimer); electionTimer = null; if (timer) clearInterval(timer); timer = null; const current = lease; lease = null; await current?.release() } }
}
