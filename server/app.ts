import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { db } from "./db/client.js";
import { authRoutes } from "./routes/auth.js";
import { aiServiceRoutes } from "./routes/ai-services.js";
import { customerRoutes } from "./routes/customers.js";
import { contentRoutes } from "./routes/content.js";
import { campaignRoutes } from "./routes/campaigns.js";
import { dealRoutes } from "./routes/deals.js";
import { healthRoutes } from "./routes/health.js";
import { integrationRoutes } from "./routes/integrations.js";
import { inboxRoutes } from "./routes/inbox.js";
import { icpRoutes } from "./routes/icp.js";
import { attributionRoutes } from "./routes/attribution.js";
import { outboxRoutes } from "./routes/outbox.js";
import { outboxWebhookRoutes } from "./routes/outbox-webhooks.js";
import { radarRoutes } from "./routes/radar.js";
import { taskRoutes } from "./routes/tasks.js";
import { systemRoutes } from "./routes/system.js";
import { staticRoutes } from "./routes/static.js";
import { adminRoutes } from "./routes/admin.js";
import { captureObservabilityException } from "./lib/observability.js";

export const buildApp = async () => {
  await migrate(db, {
    migrationsFolder: resolve(process.cwd(), "server/db/migrations-pg"),
  });
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 1_048_576,
    trustProxy: config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
  await app.register(cookie);
  await app.register(cors, { origin: config.webOrigin, credentials: true });
  await app.register(helmet, {
  contentSecurityPolicy: config.isProduction
    ? {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'"],
          fontSrc: ["'self'", "data:"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
        },
      }
    : false,
  crossOriginEmbedderPolicy: false,
})
  await app.register(rateLimit, { max: config.rateLimitMax, timeWindow: "1 minute" });
  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api/auth" });
  await app.register(aiServiceRoutes, { prefix: "/api/ai" });
  await app.register(integrationRoutes, { prefix: "/api/integrations" });
  await app.register(customerRoutes, { prefix: "/api/customers" });
  await app.register(contentRoutes, { prefix: "/api/content" });
  await app.register(campaignRoutes, { prefix: "/api/campaigns" });
  await app.register(inboxRoutes, { prefix: "/api/inbox" });
  await app.register(icpRoutes, { prefix: "/api/icp" });
  await app.register(outboxRoutes, { prefix: "/api/outbox" });
  await app.register(outboxWebhookRoutes, { prefix: "/api/outbox-webhooks" });
  await app.register(taskRoutes, { prefix: "/api/tasks" });
  await app.register(dealRoutes, { prefix: "/api/deals" });
  await app.register(radarRoutes, { prefix: "/api/radar" });
  await app.register(attributionRoutes, { prefix: "/api/attribution" });
  await app.register(systemRoutes, { prefix: "/api/system" });
  await app.register(adminRoutes, { prefix: "/api/admin" });

  // Serve built frontend in production (when dist/ exists)
  const distDir = resolve(process.cwd(), "dist");
  if (existsSync(join(distDir, "index.html"))) {
    await app.register(staticRoutes, { distDir });
  }

  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: "NOT_FOUND", message: "接口不存在。" }),
  );
  app.setErrorHandler((error, request, reply) => {
    const observedStatusCode = (error as { statusCode?: number }).statusCode;
    if (observedStatusCode === undefined || observedStatusCode >= 500) captureObservabilityException(error);
    request.log.error(
      {
        err: error,
        url: request.routeOptions?.url ?? request.url,
        method: request.method,
        statusCode: (error as { statusCode?: number }).statusCode,
      },
      (error as Error).message,
    );
    if (reply.sent) return;
    const candidate = error as { statusCode?: number; message?: string };
    const statusCode =
      candidate.statusCode && candidate.statusCode < 500
        ? candidate.statusCode
        : 500;
    reply.code(statusCode).send({
      error: statusCode < 500 ? "REQUEST_ERROR" : "SERVER_ERROR",
      message: statusCode < 500 ? candidate.message : "服务器处理失败。",
    });
  });
  return app;
};
