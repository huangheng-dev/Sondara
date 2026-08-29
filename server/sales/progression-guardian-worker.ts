import { config } from '../config.js'
import { acquireLeaderLease, LEADER_KEYS, type LeaderLease } from '../lib/leader-lock.js'
import { logger } from '../logger.js'
import { reconcileSalesProgression } from './progression-guardian.js'
import { reconcileClosedLoop } from '../automation/closed-loop.js'

export const createSalesProgressionGuardianWorker = (intervalMs = config.salesGuardianIntervalMs) => {
  let timer: ReturnType<typeof setInterval> | undefined
  let electionTimer: ReturnType<typeof setTimeout> | undefined
  let lease: LeaderLease | null = null
  let running = false

  const processOnce = async () => {
    if (running) return null
    running = true
    try {
      const sales = await reconcileSalesProgression()
      const closure = await reconcileClosedLoop()
      return { ...sales, ...closure }
    }
    finally { running = false }
  }
  const tick = async () => {
    try { await processOnce() }
    catch (error) { logger.error({ err: error }, 'Sales progression guardian tick failed') }
  }
  const scheduleElection = () => {
    if (electionTimer) return
    electionTimer = setTimeout(() => { electionTimer = undefined; void elect() }, config.workerLeaderElectionIntervalMs)
    electionTimer.unref?.()
  }
  const activate = () => {
    if (timer) return
    void tick()
    timer = setInterval(() => void tick(), intervalMs)
    timer.unref?.()
    logger.info({ intervalMs }, 'Sales progression guardian elected as leader')
  }
  const elect = async () => {
    if (timer || electionTimer) return
    if (!config.workerLeaderLock) return activate()
    try {
      lease = await acquireLeaderLease(LEADER_KEYS.salesGuardian, () => {
        if (timer) clearInterval(timer)
        timer = undefined
        void lease?.release()
        lease = null
        scheduleElection()
      })
      if (lease) activate()
      else scheduleElection()
    } catch (error) {
      logger.warn({ err: error }, 'Sales progression guardian leader election failed')
      scheduleElection()
    }
  }
  return {
    processOnce,
    start: elect,
    stop: async () => {
      if (timer) clearInterval(timer)
      if (electionTimer) clearTimeout(electionTimer)
      timer = undefined
      electionTimer = undefined
      const current = lease
      lease = null
      await current?.release()
    },
  }
}
