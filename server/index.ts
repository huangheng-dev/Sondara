import "./instrument.js";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { databaseRuntime } from "./db/client.js";
import { createRadarWorker } from "./radar/worker.js";
import { createOutboxWorker } from "./outbox/worker.js";
import { createImapReceiver } from "./inbox/imap-receiver.js";
import { createBackupWorker } from "./operations/backup-worker.js";
import { requireAuth } from "./plugins/auth.js";
import { captureObservabilityException, shutdownObservability } from "./lib/observability.js";

const app = await buildApp();
const radarWorker = createRadarWorker(config.radarWorkerIntervalMs);
const outboxWorker = createOutboxWorker(config.outboxWorkerIntervalMs);
const imapReceiver = createImapReceiver(config.imapPollIntervalMs);
const backupWorker = createBackupWorker();

let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "Shutting down…");
  await Promise.allSettled([
    radarWorker.stop(),
    outboxWorker.stop(),
    imapReceiver.stop(),
    backupWorker.stop(),
  ]);
  const forceTimer = setTimeout(async () => {
    app.log.error("Forced shutdown after 10s timeout");
    await databaseRuntime.close();
    process.exit(1);
  }, 10_000);
  forceTimer.unref();
  try {
    await shutdownObservability();
    await app.close();
    await databaseRuntime.close();
    app.log.info("Shutdown complete");
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error }, "Error during shutdown");
    await databaseRuntime.close();
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("uncaughtException", (error) => {
  captureObservabilityException(error);
  app.log.error({ err: error }, "Uncaught exception");
});
process.on("unhandledRejection", (reason) => {
  captureObservabilityException(reason instanceof Error ? reason : new Error(String(reason)));
  app.log.error({ reason }, "Unhandled rejection");
});

app.post('/api/inbox/imap/poll', { onRequest: [requireAuth] }, async () => {
  await imapReceiver.pollNow();
  return { ok: true };
});

await app.listen({ host: config.host, port: config.port });
if (config.radarWorkerEnabled) radarWorker.start();
if (config.outboxWorkerEnabled) outboxWorker.start();
if (config.imapEnabled) imapReceiver.start();
if (config.backupEnabled) backupWorker.start();
app.log.info(
  {
    host: config.host,
    port: config.port,
    env: config.isProduction ? "production" : "development",
    version: config.version,
    databaseDriver: config.databaseDriver,
  },
  `Sondara API v${config.version} running`,
);
