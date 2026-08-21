import type { FastifyPluginAsync } from "fastify";
import { eq, sql } from "drizzle-orm";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { db } from "../db/client.js";
import { config } from "../config.js";
import { requireAuth } from "../plugins/auth.js";
import { audit } from "../lib/audit.js";
import * as schema from "../db/schema.js";
import { createDatabaseBackup, listDatabaseBackups, validateDatabaseBackup } from "../operations/backup-worker.js";

export const systemRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", requireAuth);

  // Export all workspace-scoped business data as JSON
  app.get("/export", async (request, reply) => {
    const ws = request.auth.workspaceId;
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
