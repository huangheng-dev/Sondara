import type { FastifyPluginAsync } from "fastify";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import {
  auditLogs,
  contactSuppressions,
  inboxContacts,
  messageDeliveryEvents,
  messageEntries,
  messageThreads,
  outboundChannelConnections,
  outboxJobs,
} from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { encryptSecret } from "../lib/secret-vault.js";
import { listRecentChannelEvents } from "../outbox/events.js";
import {
  activateWaitingJobs,
  getAvailableConnection,
  processOutboxJob,
  serializeOutboundConnection,
  testSmtpConnection,
} from "../outbox/service.js";
import { requireAdmin, requireAuth } from "../plugins/auth.js";
import { generateWebhookSecret } from "../outbox/webhook-signature.js";

const connectionInput = z.object({
  name: z.string().trim().min(1).max(120),
  host: z.string().trim().min(1).max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(1000),
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.string().trim().email(),
  replyTo: z.string().trim().email().nullable().optional(),
  priority: z.coerce.number().int().min(1).max(100).optional(),
  enabled: z.boolean().default(true),
});
const connectionPatch = connectionInput
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const jobsQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z
    .enum([
      "all",
      "awaiting_configuration",
      "queued",
      "processing",
      "sent",
      "failed",
      "cancelled",
    ])
    .default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(50).default(10),
});
const retryInput = z.object({ confirmation: z.literal(true) });
const suppressionQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(["active", "restored", "all"]).default("active"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(20),
});
const audit = (
  workspaceId: string,
  actorUserId: string,
  action: string,
  entityId: string,
  metadata: unknown = {},
) =>
  db
    .insert(auditLogs)
    .values({
      id: createId("aud"),
      workspaceId,
      actorUserId,
      action,
      entityType: "outbound_delivery",
      entityId,
      metadata: JSON.stringify(metadata),
      createdAt: Date.now(),
    })
    .run();

const listConnections = (workspaceId: string) =>
  db
    .select()
    .from(outboundChannelConnections)
    .where(eq(outboundChannelConnections.workspaceId, workspaceId))
    .orderBy(
      asc(outboundChannelConnections.priority),
      asc(outboundChannelConnections.createdAt),
    )
    .all()
    .map(serializeOutboundConnection);

export const outboxRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  app.get("/connections", async (request) => ({
    items: listConnections(request.auth.workspaceId),
  }));

  app.post("/connections", { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = connectionInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: parsed.error.issues[0]?.message,
      });
    const now = Date.now();
    const encrypted = encryptSecret(parsed.data.password);
    const webhookSecret = generateWebhookSecret();
    const encryptedWebhookSecret = encryptSecret(webhookSecret);
    const priority =
      parsed.data.priority ??
      (db
        .select({
          max: sql<number>`coalesce(max(${outboundChannelConnections.priority}), 0)`,
        })
        .from(outboundChannelConnections)
        .where(
          eq(outboundChannelConnections.workspaceId, request.auth.workspaceId),
        )
        .get()?.max ?? 0) + 1;
    const record = {
      id: createId("ocn"),
      workspaceId: request.auth.workspaceId,
      name: parsed.data.name,
      provider: "smtp",
      host: parsed.data.host,
      port: parsed.data.port,
      secure: parsed.data.secure,
      username: parsed.data.username,
      fromName: parsed.data.fromName,
      fromEmail: parsed.data.fromEmail,
      replyTo: parsed.data.replyTo ?? null,
      priority,
      enabled: parsed.data.enabled,
      status: "untested",
      secretCiphertext: encrypted.ciphertext,
      secretIv: encrypted.iv,
      secretTag: encrypted.tag,
      secretEnding: parsed.data.password.slice(-4),
      webhookSecretCiphertext: encryptedWebhookSecret.ciphertext,
      webhookSecretIv: encryptedWebhookSecret.iv,
      webhookSecretTag: encryptedWebhookSecret.tag,
      webhookSecretEnding: webhookSecret.slice(-4),
      lastLatencyMs: null,
      lastError: null,
      lastTestedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    try {
      db.insert(outboundChannelConnections).values(record).run();
    } catch {
      return reply
        .code(409)
        .send({ error: "CONNECTION_EXISTS", message: "已存在同名发送服务。" });
    }
    audit(
      request.auth.workspaceId,
      request.auth.userId,
      "outbound.connection_created",
      record.id,
      { provider: "smtp", host: record.host, port: record.port },
    );
    return reply.code(201).send({
      ...serializeOutboundConnection(
        db
          .select()
          .from(outboundChannelConnections)
          .where(eq(outboundChannelConnections.id, record.id))
          .get()!,
      ),
      webhookSecret,
    });
  });

  app.patch("/connections/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = connectionPatch.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_INPUT",
        message: parsed.error.issues[0]?.message,
      });
    const existing = db
      .select()
      .from(outboundChannelConnections)
      .where(
        and(
          eq(outboundChannelConnections.id, id),
          eq(outboundChannelConnections.workspaceId, request.auth.workspaceId),
        ),
      )
      .get();
    if (!existing)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "发送服务不存在。" });
    const { password, ...fields } = parsed.data;
    const encrypted = password ? encryptSecret(password) : null;
    const requiresRetest = [
      "host",
      "port",
      "secure",
      "username",
      "password",
      "fromEmail",
    ].some((key) => key in parsed.data);
    db.update(outboundChannelConnections)
      .set({
        ...fields,
        ...(encrypted
          ? {
              secretCiphertext: encrypted.ciphertext,
              secretIv: encrypted.iv,
              secretTag: encrypted.tag,
              secretEnding: password!.slice(-4),
            }
          : {}),
        status: requiresRetest ? "untested" : existing.status,
        lastError: requiresRetest ? null : existing.lastError,
        updatedAt: Date.now(),
      })
      .where(eq(outboundChannelConnections.id, id))
      .run();
    audit(
      request.auth.workspaceId,
      request.auth.userId,
      "outbound.connection_updated",
      id,
      { fields: Object.keys(parsed.data).filter((key) => key !== "password") },
    );
    return serializeOutboundConnection(
      db
        .select()
        .from(outboundChannelConnections)
        .where(eq(outboundChannelConnections.id, id))
        .get()!,
    );
  });

  app.post("/connections/:id/test", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const connection = db
      .select()
      .from(outboundChannelConnections)
      .where(
        and(
          eq(outboundChannelConnections.id, id),
          eq(outboundChannelConnections.workspaceId, request.auth.workspaceId),
        ),
      )
      .get();
    if (!connection)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "发送服务不存在。" });
    try {
      const result = await testSmtpConnection(connection);
      const now = Date.now();
      db.update(outboundChannelConnections)
        .set({
          status: "available",
          lastLatencyMs: result.latencyMs,
          lastError: null,
          lastTestedAt: now,
          updatedAt: now,
        })
        .where(eq(outboundChannelConnections.id, id))
        .run();
      const activatedJobs = activateWaitingJobs(request.auth.workspaceId, id);
      audit(
        request.auth.workspaceId,
        request.auth.userId,
        "outbound.connection_tested",
        id,
        { success: true, activatedJobs },
      );
      return { ok: true, latencyMs: result.latencyMs, activatedJobs };
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "SMTP 连接测试失败。";
      const now = Date.now();
      db.update(outboundChannelConnections)
        .set({
          status: "error",
          lastLatencyMs: null,
          lastError: message,
          lastTestedAt: now,
          updatedAt: now,
        })
        .where(eq(outboundChannelConnections.id, id))
        .run();
      audit(
        request.auth.workspaceId,
        request.auth.userId,
        "outbound.connection_tested",
        id,
        { success: false },
      );
      return reply.code(502).send({ error: "SMTP_UNAVAILABLE", message });
    }
  });

  app.delete("/connections/:id", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const existing = db
      .select()
      .from(outboundChannelConnections)
      .where(
        and(
          eq(outboundChannelConnections.id, id),
          eq(outboundChannelConnections.workspaceId, request.auth.workspaceId),
        ),
      )
      .get();
    if (!existing)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "发送服务不存在。" });
    db.transaction((tx) => {
      tx.update(outboxJobs)
        .set({
          status: "awaiting_configuration",
          connectionId: null,
          lastError: "发送服务已移除，请重新配置。",
          updatedAt: Date.now(),
        })
        .where(
          and(
            eq(outboxJobs.workspaceId, request.auth.workspaceId),
            eq(outboxJobs.connectionId, id),
            or(
              eq(outboxJobs.status, "queued"),
              eq(outboxJobs.status, "processing"),
            ),
          ),
        )
        .run();
      tx.delete(outboundChannelConnections)
        .where(eq(outboundChannelConnections.id, id))
        .run();
    });
    audit(
      request.auth.workspaceId,
      request.auth.userId,
      "outbound.connection_deleted",
      id,
    );
    return reply.code(204).send();
  });

  app.post("/connections/:id/webhook-secret/rotate", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = z
      .object({ confirmation: z.literal(true) })
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          error: "CONFIRMATION_REQUIRED",
          message: "轮换事件签名密钥前必须明确确认。",
        });
    const existing = db
      .select()
      .from(outboundChannelConnections)
      .where(
        and(
          eq(outboundChannelConnections.id, id),
          eq(outboundChannelConnections.workspaceId, request.auth.workspaceId),
        ),
      )
      .get();
    if (!existing)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "发送服务不存在。" });
    const webhookSecret = generateWebhookSecret();
    const encrypted = encryptSecret(webhookSecret);
    db.update(outboundChannelConnections)
      .set({
        webhookSecretCiphertext: encrypted.ciphertext,
        webhookSecretIv: encrypted.iv,
        webhookSecretTag: encrypted.tag,
        webhookSecretEnding: webhookSecret.slice(-4),
        updatedAt: Date.now(),
      })
      .where(eq(outboundChannelConnections.id, id))
      .run();
    audit(
      request.auth.workspaceId,
      request.auth.userId,
      "outbound.webhook_secret_rotated",
      id,
    );
    return {
      id,
      webhookSecret,
      webhookSecretEnding: webhookSecret.slice(-4),
      webhookUrl: `/api/outbox-webhooks/${id}`,
    };
  });

  app.get("/events", async (request) => ({
    items: listRecentChannelEvents(request.auth.workspaceId, 100),
  }));

  app.get("/suppressions", async (request, reply) => {
    const parsed = suppressionQuery.safeParse(request.query);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          error: "INVALID_QUERY",
          message: parsed.error.issues[0]?.message,
        });
    const { q, status, page, pageSize } = parsed.data;
    const conditions = [
      eq(contactSuppressions.workspaceId, request.auth.workspaceId),
    ];
    if (status !== "all")
      conditions.push(eq(contactSuppressions.active, status === "active"));
    if (q)
      conditions.push(
        or(
          like(contactSuppressions.destination, `%${q}%`),
          like(contactSuppressions.reason, `%${q}%`),
        )!,
      );
    const where = and(...conditions);
    const total =
      db
        .select({ count: sql<number>`count(*)` })
        .from(contactSuppressions)
        .where(where)
        .get()?.count ?? 0;
    const items = db
      .select()
      .from(contactSuppressions)
      .where(where)
      .orderBy(desc(contactSuppressions.updatedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .all();
    return {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  });

  app.post("/suppressions/:id/restore", { preHandler: requireAdmin }, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = z
      .object({ confirmation: z.literal(true) })
      .safeParse(request.body);
    if (!parsed.success)
      return reply
        .code(400)
        .send({
          error: "CONFIRMATION_REQUIRED",
          message: "恢复发送前必须确认已获得联系人许可。",
        });
    const suppression = db
      .select()
      .from(contactSuppressions)
      .where(
        and(
          eq(contactSuppressions.id, id),
          eq(contactSuppressions.workspaceId, request.auth.workspaceId),
        ),
      )
      .get();
    if (!suppression)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "抑制记录不存在。" });
    db.update(contactSuppressions)
      .set({ active: false, updatedAt: Date.now() })
      .where(eq(contactSuppressions.id, id))
      .run();
    audit(
      request.auth.workspaceId,
      request.auth.userId,
      "outbound.suppression_restored",
      id,
      { destination: suppression.destination },
    );
    return { id, active: false };
  });

  app.get("/jobs", async (request, reply) => {
    const parsed = jobsQuery.safeParse(request.query);
    if (!parsed.success)
      return reply.code(400).send({
        error: "INVALID_QUERY",
        message: parsed.error.issues[0]?.message,
      });
    const { q, status, page, pageSize } = parsed.data;
    const conditions = [eq(outboxJobs.workspaceId, request.auth.workspaceId)];
    if (status !== "all") conditions.push(eq(outboxJobs.status, status));
    if (q)
      conditions.push(
        or(
          like(messageEntries.body, `%${q}%`),
          like(messageThreads.subject, `%${q}%`),
          like(inboxContacts.name, `%${q}%`),
          like(inboxContacts.company, `%${q}%`),
        )!,
      );
    const base = db
      .select({
        job: outboxJobs,
        message: messageEntries,
        thread: messageThreads,
        contact: inboxContacts,
      })
      .from(outboxJobs)
      .innerJoin(messageEntries, eq(messageEntries.id, outboxJobs.messageId))
      .innerJoin(messageThreads, eq(messageThreads.id, outboxJobs.threadId))
      .innerJoin(inboxContacts, eq(inboxContacts.id, messageThreads.contactId))
      .where(and(...conditions));
    const all = base.orderBy(desc(outboxJobs.createdAt)).all();
    const items = all
      .slice((page - 1) * pageSize, page * pageSize)
      .map((row) => ({
        ...row.job,
        message: {
          id: row.message.id,
          body: row.message.body,
          status: row.message.status,
        },
        thread: { id: row.thread.id, subject: row.thread.subject },
        contact: {
          name: row.contact.name,
          company: row.contact.company,
          email: row.contact.email,
        },
        connection: row.job.connectionId
          ? (listConnections(request.auth.workspaceId).find(
              (item) => item.id === row.job.connectionId,
            ) ?? null)
          : null,
      }));
    return {
      items,
      total: all.length,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(all.length / pageSize)),
    };
  });

  app.get("/jobs/:id/events", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const job = db
      .select()
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.id, id),
          eq(outboxJobs.workspaceId, request.auth.workspaceId),
        ),
      )
      .get();
    if (!job)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "发送任务不存在。" });
    const items = db
      .select()
      .from(messageDeliveryEvents)
      .where(
        and(
          eq(messageDeliveryEvents.outboxJobId, id),
          eq(messageDeliveryEvents.workspaceId, request.auth.workspaceId),
        ),
      )
      .orderBy(desc(messageDeliveryEvents.createdAt))
      .all()
      .map((item) => ({ ...item, metadata: JSON.parse(item.metadataJson) }));
    return { items };
  });

  app.post("/jobs/:id/retry", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const parsed = retryInput.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({
        error: "CONFIRMATION_REQUIRED",
        message: "重试发送前必须明确确认。",
      });
    const job = db
      .select()
      .from(outboxJobs)
      .where(
        and(
          eq(outboxJobs.id, id),
          eq(outboxJobs.workspaceId, request.auth.workspaceId),
        ),
      )
      .get();
    if (!job)
      return reply
        .code(404)
        .send({ error: "NOT_FOUND", message: "发送任务不存在。" });
    if (!["failed", "awaiting_configuration"].includes(job.status))
      return reply
        .code(409)
        .send({ error: "INVALID_STATUS", message: "当前任务状态不能重试。" });
    const connection = getAvailableConnection(request.auth.workspaceId);
    if (!connection)
      return reply.code(409).send({
        error: "NO_AVAILABLE_CONNECTION",
        message: "请先配置并测试可用的 SMTP 服务。",
      });
    db.update(outboxJobs)
      .set({
        status: "queued",
        connectionId: connection.id,
        attempts: 0,
        lastError: null,
        scheduledAt: Date.now(),
        completedAt: null,
        updatedAt: Date.now(),
      })
      .where(eq(outboxJobs.id, id))
      .run();
    audit(
      request.auth.workspaceId,
      request.auth.userId,
      "outbound.job_retried",
      id,
    );
    void processOutboxJob(id);
    return { id, status: "queued" };
  });
};
