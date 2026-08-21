import type { FastifyPluginAsync } from "fastify";
import { and, eq, gte, sql } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { requireAuth } from "../plugins/auth.js";
import { audit } from "../lib/audit.js";
import * as schema from "../db/schema.js";
import { createId } from "../lib/ids.js";
import { createDatabaseBackup, listDatabaseBackups, validateDatabaseBackup } from "../operations/backup-worker.js";

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  // Export all workspace-scoped business data as JSON
  // Requires approval if the workspace has 500+ customers (bulk export gate)
  app.get("/export", async (request, reply) => {
    const ws = request.auth.workspaceId;

    const customerCount = (await db.$first(db.select({ count: sql<number>`count(*)` }).from(schema.customers).where(eq(schema.customers.workspaceId, ws))))?.count ?? 0;
    if (customerCount >= 500) {
      const approvalAction = "system.bulk_export";
      const approved = await db.$first(db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(and(
        eq(schema.approvalRequests.workspaceId, ws),
        eq(schema.approvalRequests.entityType, "workspace"),
        eq(schema.approvalRequests.entityId, ws),
        eq(schema.approvalRequests.action, approvalAction),
        eq(schema.approvalRequests.status, "approved"),
      )));
      if (!approved) {
        const pending = await db.$first(db.select({ id: schema.approvalRequests.id }).from(schema.approvalRequests).where(and(
          eq(schema.approvalRequests.workspaceId, ws),
          eq(schema.approvalRequests.entityType, "workspace"),
          eq(schema.approvalRequests.entityId, ws),
          eq(schema.approvalRequests.action, approvalAction),
          eq(schema.approvalRequests.status, "pending"),
        )));
        const approvalId = pending?.id ?? createId("apr");
        if (!pending) {
          const now = Date.now();
          await db.insert(schema.approvalRequests).values({
            id: approvalId, workspaceId: ws, entityType: "workspace", entityId: ws,
            action: approvalAction, note: `批量数据导出：${customerCount} 家客户及全部业务数据。`,
            requestedByUserId: request.auth.userId, status: "pending", createdAt: now, updatedAt: now,
          });
          await audit(ws, request.auth.userId, "approval.requested", "workspace", ws, { approvalId, action: approvalAction, customerCount });
        }
        return reply.code(409).send({ error: "APPROVAL_REQUIRED", message: `工作区有 ${customerCount} 家客户，批量导出需要审批。审批通过后请重新导出。`, approvalId });
      }
    }

    const now = new Date().toISOString().slice(0, 10);

    const exportData: Record<string, unknown> = {
      meta: {
        exportedAt: new Date().toISOString(),
        workspaceId: ws,
        version: "0.1.0",
      },
    };

    // Tables to export (workspace-scoped only; exclude encrypted secrets, sessions, users)
    const workspaceTables = [
      ["customers", schema.customers], ["tasks", schema.tasks], ["deals", schema.deals],
      ["content_assets", schema.contentAssets], ["content_versions", schema.contentVersions],
      ["content_quality_checks", schema.contentQualityChecks], ["content_generation_runs", schema.contentGenerationRuns],
      ["campaigns", schema.campaigns], ["campaign_steps", schema.campaignSteps],
      ["campaign_audience_members", schema.campaignAudienceMembers], ["campaign_content_links", schema.campaignContentLinks],
      ["campaign_execution_events", schema.campaignExecutionEvents], ["inbox_contacts", schema.inboxContacts],
      ["message_threads", schema.messageThreads], ["message_entries", schema.messageEntries],
      ["message_thread_reads", schema.messageThreadReads], ["radar_tasks", schema.radarTasks],
      ["radar_candidates", schema.radarCandidates], ["candidate_evidence", schema.candidateEvidence],
      ["candidate_contacts", schema.candidateContacts], ["radar_queue_items", schema.radarQueueItems],
      ["radar_job_events", schema.radarJobEvents], ["business_profiles", schema.businessProfiles],
      ["knowledge_items", schema.knowledgeItems], ["channel_costs", schema.channelCosts],
      ["contact_suppressions", schema.contactSuppressions],
    ] as const;

    for (const [name, table] of workspaceTables) {
      exportData[name] = (await db
              .select()
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .from(table as any)
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .where(eq(table.workspaceId, ws)));
    }

    // Outbound channel connections (masked — no secrets)
    exportData["outbound_channel_connections"] = (await db
          .select({
            id: schema.outboundChannelConnections.id,
            provider: schema.outboundChannelConnections.provider,
            host: schema.outboundChannelConnections.host,
            port: schema.outboundChannelConnections.port,
            username: schema.outboundChannelConnections.username,
            fromEmail: schema.outboundChannelConnections.fromEmail,
            fromName: schema.outboundChannelConnections.fromName,
            priority: schema.outboundChannelConnections.priority,
            enabled: schema.outboundChannelConnections.enabled,
            createdAt: schema.outboundChannelConnections.createdAt,
            updatedAt: schema.outboundChannelConnections.updatedAt,
          })
          .from(schema.outboundChannelConnections)
          .where(eq(schema.outboundChannelConnections.workspaceId, ws)));

    // AI services (masked — no key material)
    exportData["ai_services"] = (await db
          .select({
            id: schema.aiServices.id,
            name: schema.aiServices.name,
            provider: schema.aiServices.provider,
            endpoint: schema.aiServices.endpoint,
            model: schema.aiServices.model,
            priority: schema.aiServices.priority,
            enabled: schema.aiServices.enabled,
            status: schema.aiServices.status,
            lastLatencyMs: schema.aiServices.lastLatencyMs,
            lastTestedAt: schema.aiServices.lastTestedAt,
            createdAt: schema.aiServices.createdAt,
          })
          .from(schema.aiServices)
          .where(eq(schema.aiServices.workspaceId, ws)));

    await audit(ws, request.auth.userId, "data.export", "workspace", ws, { tables: workspaceTables.length });

    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="sondara-export-${now}.json"`)
      .send(exportData);
  });

  // Create a full driver-native backup and stream it.
  app.post("/backup", {
    preHandler: async (request, reply) => {
      if (request.auth.role !== "owner") {
        return reply.code(403).send({ error: "FORBIDDEN", message: "只有工作区所有者可以创建数据库备份。" });
      }
    },
  }, async (request, reply) => {
    try {
      const backup = await createDatabaseBackup();
      const filePath = join(config.backupDirectory, backup.fileName);

      await audit(request.auth.workspaceId, request.auth.userId, "data.backup", "workspace", request.auth.workspaceId, { fileName: backup.fileName, verifiedAt: backup.verifiedAt });

      const stream = createReadStream(filePath);
      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="${backup.fileName}"`)
        .send(stream);
    } catch (error) {
      request.log.error({ err: error }, "Backup failed");
      return reply.code(500).send({ error: "BACKUP_FAILED", message: "数据库备份失败。" });
    }
  });

  app.get("/backups", {
    preHandler: async (request, reply) => {
      if (request.auth.role !== "owner") return reply.code(403).send({ error: "FORBIDDEN", message: "只有工作区所有者可以查看数据库备份。" });
    },
  }, async () => ({ items: await listDatabaseBackups(), automatic: config.backupEnabled, retentionCount: config.backupRetentionCount }));

  app.post("/backups/:fileName/validate", {
    preHandler: async (request, reply) => {
      if (request.auth.role !== "owner") return reply.code(403).send({ error: "FORBIDDEN", message: "只有工作区所有者可以验证数据库备份。" });
    },
  }, async (request, reply) => {
    try {
      const result = await validateDatabaseBackup((request.params as { fileName: string }).fileName);
      await audit(request.auth.workspaceId, request.auth.userId, "data.backup.validated", "workspace", request.auth.workspaceId, result);
      return result;
    } catch (error) {
      request.log.warn({ err: error }, "Backup validation failed");
      return reply.code(400).send({ error: "BACKUP_INVALID", message: "备份校验失败，不能用于恢复。" });
    }
  });

  app.get("/connector-health", async (request) => {
    const workspaceId = request.auth.workspaceId;
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000; // last 7 days

    const [failedRadarEvents, failedOutboxJobs, aiServiceStatuses, failedRadarTasks, failedRadarQueue, outboundConns, integrationConns, leadSourceConns] = await Promise.all([
      db.select({
        id: schema.radarJobEvents.id,
        radarTaskId: schema.radarJobEvents.radarTaskId,
        message: schema.radarJobEvents.message,
        eventType: schema.radarJobEvents.eventType,
        createdAt: schema.radarJobEvents.createdAt,
      })
        .from(schema.radarJobEvents)
        .where(and(
          eq(schema.radarJobEvents.workspaceId, workspaceId),
          eq(schema.radarJobEvents.level, "error"),
          gte(schema.radarJobEvents.createdAt, since),
        ))
        .orderBy(sql`${schema.radarJobEvents.createdAt} DESC`)
        .limit(20),
      db.select({
        id: schema.outboxJobs.id,
        channel: schema.outboxJobs.channel,
        status: schema.outboxJobs.status,
        lastError: schema.outboxJobs.lastError,
        attempts: schema.outboxJobs.attempts,
        maxAttempts: schema.outboxJobs.maxAttempts,
        updatedAt: schema.outboxJobs.updatedAt,
      })
        .from(schema.outboxJobs)
        .where(and(
          eq(schema.outboxJobs.workspaceId, workspaceId),
          eq(schema.outboxJobs.status, "failed"),
          gte(schema.outboxJobs.updatedAt, since),
        ))
        .orderBy(sql`${schema.outboxJobs.updatedAt} DESC`)
        .limit(20),
      db.select({
        id: schema.aiServices.id,
        name: schema.aiServices.name,
        provider: schema.aiServices.provider,
        status: schema.aiServices.status,
        lastLatencyMs: schema.aiServices.lastLatencyMs,
        lastTestedAt: schema.aiServices.lastTestedAt,
      })
        .from(schema.aiServices)
        .where(and(
          eq(schema.aiServices.workspaceId, workspaceId),
          eq(schema.aiServices.enabled, true),
        )),
      db.select({
        id: schema.radarTasks.id,
        name: schema.radarTasks.name,
        status: schema.radarTasks.status,
        lastError: schema.radarTasks.lastError,
        updatedAt: schema.radarTasks.updatedAt,
      })
        .from(schema.radarTasks)
        .where(and(
          eq(schema.radarTasks.workspaceId, workspaceId),
          eq(schema.radarTasks.status, "failed"),
          gte(schema.radarTasks.updatedAt, since),
        ))
        .orderBy(sql`${schema.radarTasks.updatedAt} DESC`)
        .limit(10),
      db.select({
        id: schema.radarQueueItems.id,
        radarTaskId: schema.radarQueueItems.radarTaskId,
        status: schema.radarQueueItems.status,
        lastError: schema.radarQueueItems.lastError,
        attempts: schema.radarQueueItems.attempts,
        maxAttempts: schema.radarQueueItems.maxAttempts,
        updatedAt: schema.radarQueueItems.updatedAt,
      })
        .from(schema.radarQueueItems)
        .where(and(
          eq(schema.radarQueueItems.workspaceId, workspaceId),
          eq(schema.radarQueueItems.status, "failed"),
          gte(schema.radarQueueItems.updatedAt, since),
        ))
        .orderBy(sql`${schema.radarQueueItems.updatedAt} DESC`)
        .limit(10),
      db.select({
        id: schema.outboundChannelConnections.id,
        name: schema.outboundChannelConnections.name,
        provider: schema.outboundChannelConnections.provider,
        enabled: schema.outboundChannelConnections.enabled,
        status: schema.outboundChannelConnections.status,
        imapEnabled: schema.outboundChannelConnections.imapEnabled,
        lastError: schema.outboundChannelConnections.lastError,
        lastLatencyMs: schema.outboundChannelConnections.lastLatencyMs,
        lastTestedAt: schema.outboundChannelConnections.lastTestedAt,
      })
        .from(schema.outboundChannelConnections)
        .where(eq(schema.outboundChannelConnections.workspaceId, workspaceId)),
      db.select({
        id: schema.integrationConnections.id,
        name: schema.integrationConnections.name,
        provider: schema.integrationConnections.provider,
        category: schema.integrationConnections.category,
        enabled: schema.integrationConnections.enabled,
        status: schema.integrationConnections.status,
        lastError: schema.integrationConnections.lastError,
        lastLatencyMs: schema.integrationConnections.lastLatencyMs,
        lastTestedAt: schema.integrationConnections.lastTestedAt,
      })
        .from(schema.integrationConnections)
        .where(eq(schema.integrationConnections.workspaceId, workspaceId)),
      db.select({
        id: schema.leadSourceConnections.id,
        name: schema.leadSourceConnections.name,
        provider: schema.leadSourceConnections.provider,
        enabled: schema.leadSourceConnections.enabled,
        status: schema.leadSourceConnections.status,
        hasAccessToken: sql<boolean>`${schema.leadSourceConnections.accessTokenCiphertext} IS NOT NULL`,
        lastError: schema.leadSourceConnections.lastError,
        lastSyncedAt: schema.leadSourceConnections.lastSyncedAt,
      })
        .from(schema.leadSourceConnections)
        .where(eq(schema.leadSourceConnections.workspaceId, workspaceId)),
    ]);

    const failedAiServices = aiServiceStatuses.filter(s => s.status === "degraded" || s.status === "error");
    const unhealthyOutbound = outboundConns.filter(c => !c.enabled || c.status === "error" || c.status === "failed");
    const unhealthyIntegrations = integrationConns.filter(c => !c.enabled || c.status === "error" || c.status === "failed");
    const unhealthyLeadSources = leadSourceConns.filter(c => !c.enabled || c.status === "error" || c.status === "failed" || (c.enabled && !c.hasAccessToken));

    return {
      generatedAt: Date.now(),
      since,
      summary: {
        radarErrors: failedRadarEvents.length,
        outboxFailures: failedOutboxJobs.length,
        aiServiceDegraded: failedAiServices.length,
        failedRadarTasks: failedRadarTasks.length,
        failedRadarQueue: failedRadarQueue.length,
        outboundUnhealthy: unhealthyOutbound.length,
        integrationUnhealthy: unhealthyIntegrations.length,
        leadSourceUnhealthy: unhealthyLeadSources.length,
        totalIssues: failedRadarEvents.length + failedOutboxJobs.length + failedAiServices.length + failedRadarTasks.length + failedRadarQueue.length + unhealthyOutbound.length + unhealthyIntegrations.length + unhealthyLeadSources.length,
      },
      connections: {
        outbound: outboundConns,
        integrations: integrationConns,
        leadSources: leadSourceConns,
      },
      radarEvents: failedRadarEvents,
      outboxFailures: failedOutboxJobs,
      aiServices: aiServiceStatuses,
      failedRadarTasks,
      failedRadarQueue,
    };
  });

  app.get("/operations", {
    preHandler: async (request, reply) => {
      if (request.auth.role !== "owner") return reply.code(403).send({ error: "FORBIDDEN", message: "只有工作区所有者可以查看运维状态。" });
    },
  }, async request => {
    const workspaceId = request.auth.workspaceId;
    const [customers, tasks, deals, radarTasks, queuedOutbound] = await Promise.all([
      db.$first(db.select({ count: sql<number>`count(*)` }).from(schema.customers).where(eq(schema.customers.workspaceId, workspaceId))),
      db.$first(db.select({ count: sql<number>`count(*)` }).from(schema.tasks).where(eq(schema.tasks.workspaceId, workspaceId))),
      db.$first(db.select({ count: sql<number>`count(*)` }).from(schema.deals).where(eq(schema.deals.workspaceId, workspaceId))),
      db.$first(db.select({ count: sql<number>`count(*)` }).from(schema.radarTasks).where(eq(schema.radarTasks.workspaceId, workspaceId))),
      db.$first(db.select({ count: sql<number>`count(*)` }).from(schema.outboxJobs).where(eq(schema.outboxJobs.workspaceId, workspaceId))),
    ]);
    const backups = await listDatabaseBackups();
    return {
      generatedAt: Date.now(),
      workers: { backup: config.backupEnabled ? "enabled" : "disabled" },
      counts: {
        customers: customers?.count ?? 0, tasks: tasks?.count ?? 0, deals: deals?.count ?? 0,
        radarTasks: radarTasks?.count ?? 0, queuedOutbound: queuedOutbound?.count ?? 0,
      },
      latestBackup: backups[0] ?? null,
    };
  });
};
