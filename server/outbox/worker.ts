import { processDueOutboxJobs, recoverStuckOutboxJobs } from "./service.js";
import { logger } from "../logger.js";

export const createOutboxWorker = (intervalMs = 5_000) => {
  let timer: NodeJS.Timeout | null = null;
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
  return {
    async start() {
      if (timer) return;
      await recoverStuckOutboxJobs();
      void tick();
      timer = setInterval(() => void tick(), intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
};
