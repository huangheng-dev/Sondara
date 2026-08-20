import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { createReadStream, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { db, sqlite } from "../db/client.js";
import { requireAuth } from "../plugins/auth.js";
import { audit } from "../lib/audit.js";
import * as schema from "../db/schema.js";

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
      "customers", "tasks", "deals", "content_assets", "content_versions",
      "content_quality_checks", "content_generation_runs", "campaigns",
      "campaign_steps", "campaign_audience_members", "campaign_content_links",
      "campaign_execution_events", "inbox_contacts", "message_threads",
      "message_entries", "message_thread_reads", "radar_tasks", "radar_candidates",
      "candidate_evidence", "candidate_contacts", "radar_queue_items",
      "radar_job_events", "business_profiles", "knowledge_items",
      "channel_costs", "contact_suppressions",
    ] as const;

    for (const name of workspaceTables) {
      const table = (schema as Record<string, unknown>)[name] as {
        workspaceId: { name: string };
      };
      exportData[name] = db
        .select()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from(table as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .where(eq(table.workspaceId as any, ws))
        .all();
    }

    // Outbound channel connections (masked — no secrets)
    exportData["outbound_channel_connections"] = db
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
      .where(eq(schema.outboundChannelConnections.workspaceId, ws))
      .all();

    // AI services (masked — no key material)
    exportData["ai_services"] = db
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
      .where(eq(schema.aiServices.workspaceId, ws))
      .all();

    audit(ws, request.auth.userId, "data.export", "workspace", ws, { tables: workspaceTables.length });

    reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="sondara-export-${now}.json"`)
      .send(exportData);
  });

  // Create a full SQLite backup (VACUUM INTO) and stream it
  app.post("/backup", {
    preHandler: async (request, reply) => {
      if (request.auth.role !== "owner") {
        return reply.code(403).send({ error: "FORBIDDEN", message: "只有工作区所有者可以创建数据库备份。" });
      }
    },
  }, async (request, reply) => {
    const ws = request.auth.workspaceId;
    const backupDir = join(tmpdir(), "sondara-backups");
    mkdirSync(backupDir, { recursive: true });

    const fileName = `sondara-backup-${randomUUID()}.db`;
    const filePath = join(backupDir, fileName);

    try {
      // VACUUM INTO creates a consistent snapshot even while WAL is active
      sqlite.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);

      audit(ws, request.auth.userId, "data.backup", "workspace", ws, { fileName });

      const stream = createReadStream(filePath);
      reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", `attachment; filename="sondara-backup-${new Date().toISOString().slice(0, 10)}.db"`)
        .send(stream);

      // Clean up after stream finishes
      stream.on("close", () => {
        try { rmSync(filePath, { force: true }); } catch { /* best effort */ }
      });
    } catch (error) {
      try { rmSync(filePath, { force: true }); } catch { /* best effort */ }
      request.log.error({ err: error }, "Backup failed");
      return reply.code(500).send({ error: "BACKUP_FAILED", message: "数据库备份失败。" });
    }
  });
};
