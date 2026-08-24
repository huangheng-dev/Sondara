import { config } from "../config.js";
import { acquireLeaderLease, LEADER_KEYS, type LeaderLease } from "../lib/leader-lock.js";
import { processDueOutboxJobs, recoverStuckOutboxJobs } from "./service.js";
import { logger } from "../logger.js";

export const createOutboxWorker = (intervalMs = 5_000) => {
  let timer: NodeJS.Timeout | null = null;
  let electionTimer: NodeJS.Timeout | null = null;
  let lease: LeaderLease | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processDueOutboxJobs();
    } catch (error) {
      logger.error({ err: error }, "Outbox worker tick failed");
    } finally {
      running = false;
    }
  };

  const scheduleElection = () => {
    if (electionTimer) return;
    electionTimer = setTimeout(() => {
      electionTimer = null;
      void elect();
    }, config.workerLeaderElectionIntervalMs);
    electionTimer.unref?.();
  };

  const activate = async () => {
    if (timer) return;
    await recoverStuckOutboxJobs();
    void tick();
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
    logger.info({ intervalMs }, "Outbox worker elected as leader");
  };

  const elect = async () => {
    if (timer || electionTimer) return;
    if (!config.workerLeaderLock) {
      await activate();
      return;
    }
    try {
      lease = await acquireLeaderLease(LEADER_KEYS.outbox, () => {
        logger.warn("Outbox worker leader lock lost; standing down");
        if (timer) clearInterval(timer);
        timer = null;
        void lease?.release();
        lease = null;
        scheduleElection();
      });
      if (lease) {
        await activate();
      } else {
        logger.info("Outbox worker is standby; another instance owns the leader lock");
        scheduleElection();
      }
    } catch (error) {
      logger.warn({ err: error }, "Outbox worker leader election failed; retrying");
      scheduleElection();
    }
  };

  return {
    start: elect,
    async stop() {
      if (electionTimer) clearTimeout(electionTimer);
      electionTimer = null;
      if (timer) clearInterval(timer);
      timer = null;
      const current = lease;
      lease = null;
      await current?.release();
    },
  };
};
