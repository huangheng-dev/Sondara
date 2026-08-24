import { downloadFile, request } from "./core";

export const systemApi = {
  exportData: () => downloadFile("/system/export", `sondara-export-${new Date().toISOString().slice(0, 10)}.json`),
  backupDatabase: () => downloadFile("/system/backup", `sondara-backup-${new Date().toISOString().slice(0, 10)}.dump`),
  listBackups: () => request<{ items: Array<{ fileName: string; createdAt: number; size: number; verifiedAt: number | null }>; automatic: boolean; retentionCount: number }>("/system/backups"),
  validateBackup: (fileName: string) => request<{ fileName: string; verifiedAt: number }>(`/system/backups/${encodeURIComponent(fileName)}/validate`, { method: "POST" }),
  operations: () => request<{ generatedAt: number; workers: { backup: "enabled" | "disabled" }; counts: { customers: number; tasks: number; deals: number; radarTasks: number; queuedOutbound: number }; latestBackup: { fileName: string; createdAt: number; size: number; verifiedAt: number | null } | null }>("/system/operations"),
  connectorHealth: () => request<{
    generatedAt: number;
    since: number;
    summary: {
      radarErrors: number;
      outboxFailures: number;
      aiServiceDegraded: number;
      failedRadarTasks: number;
      failedRadarQueue: number;
      outboundUnhealthy: number;
      integrationUnhealthy: number;
      leadSourceUnhealthy: number;
      totalIssues: number;
    };
    connections: {
      outbound: Array<{ id: string; name: string; provider: string; enabled: boolean; status: string; imapEnabled: boolean; lastError: string | null; lastLatencyMs: number | null; lastTestedAt: number | null }>;
      integrations: Array<{ id: string; name: string; provider: string; category: string; enabled: boolean; status: string; lastError: string | null; lastLatencyMs: number | null; lastTestedAt: number | null }>;
      leadSources: Array<{ id: string; name: string; provider: string; enabled: boolean; status: string; hasAccessToken: boolean; lastError: string | null; lastSyncedAt: number | null }>;
    };
    radarEvents: Array<{ id: string; radarTaskId: string; message: string; eventType: string; createdAt: number }>;
    outboxFailures: Array<{ id: string; channel: string; status: string; lastError: string | null; attempts: number; maxAttempts: number; updatedAt: number }>;
    aiServices: Array<{ id: string; name: string; provider: string; status: string; lastLatencyMs: number | null; lastTestedAt: number | null }>;
    failedRadarTasks: Array<{ id: string; name: string; status: string; lastError: string | null; updatedAt: number }>;
    failedRadarQueue: Array<{ id: string; radarTaskId: string; status: string; lastError: string | null; attempts: number; maxAttempts: number; updatedAt: number }>;
  }>("/system/connector-health"),
};
