import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { config } from "./config.js";
import { withMigrationLock } from "./db/migration-lock.js";
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
import { approvalRoutes } from "./routes/approvals.js";
import { leadSourceRoutes } from "./routes/lead-sources.js";
import { procurementRoutes } from "./routes/procurement.js";
import { externalConnectorWebhookRoutes } from "./routes/external-connector-webhooks.js";
import { automationRoutes } from "./routes/automation.js";
import { captureObservabilityException } from "./lib/observability.js";

const formatRetryDelay = (ttl: number) => {
  const seconds = Math.max(1, Math.ceil(ttl / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
};

const localizedClientErrorMessage = (statusCode: number, message?: string) => {
  if (message && /[\u3400-\u9fff]/u.test(message)) return message;
  const fallbackMessages: Record<number, string> = {
    400: "请求内容无效，请检查后重试。",
    401: "登录状态已失效，请重新登录。",
    403: "当前账户无权执行此操作。",
    404: "请求的内容不存在。",
    409: "数据状态已发生变化，请刷新后重试。",
    413: "提交的内容过大，请缩小后重试。",
    415: "不支持当前请求格式。",
    429: "请求过于频繁，请稍后重试。",
  };
  return fallbackMessages[statusCode] ?? "请求处理失败，请稍后重试。";
};

export const buildApp = async () => {
  if (config.autoMigrate) {
    await withMigrationLock(() => migrate(db, {
      migrationsFolder: resolve(process.cwd(), "server/db/migrations-sqlite"),
    }));
  }
  const app = Fastify({
    logger: { level: config.logLevel },
    bodyLimit: 1_048_576,
    trustProxy: config.trustProxy,
    requestIdHeader: 'x-request-id',
    genReqId: () => randomUUID(),
  });
  // Preserve the exact JSON bytes for webhook signature verification while
  // keeping the same parsed request.body contract for all existing routes.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const rawBody = body as Buffer;
    (request as typeof request & { rawBody?: Buffer }).rawBody = rawBody;
    if (!rawBody.length) return done(null, null);
    try { done(null, JSON.parse(rawBody.toString('utf8'))); }
    catch (cause) { done(cause instanceof Error ? cause : new Error('请求 JSON 格式无效。'), undefined); }
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
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: "1 minute",
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      error: "RATE_LIMITED",
      message: `请求过于频繁，请在 ${formatRetryDelay(context.ttl)}后重试。`,
      retryAfterMs: context.ttl,
    }),
  });
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
  await app.register(approvalRoutes, { prefix: "/api/approvals" });
  await app.register(leadSourceRoutes, { prefix: "/api/lead-sources" });
  await app.register(procurementRoutes, { prefix: "/api/procurement" });
  await app.register(externalConnectorWebhookRoutes, { prefix: "/api/external-connectors" });
  await app.register(automationRoutes, { prefix: "/api/automation" });

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
      message: statusCode < 500
        ? localizedClientErrorMessage(statusCode, candidate.message)
        : "服务器处理失败。",
    });
  });
  return app;
};
