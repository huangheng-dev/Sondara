import { resolve } from "node:path";
import { existsSync } from "node:fs";

// Load .env file if present (Node 20.12+ built-in, no dependency needed)
try {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    process.loadEnvFile(envPath);
  }
} catch {
  // .env loading is best-effort; environment variables may be injected directly
}

const numberFromEnv = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const booleanFromEnv = (value: string | undefined, fallback = false) => {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
};

const logLevel = process.env.SONDARA_LOG_LEVEL ??
  (process.env.NODE_ENV === "production" ? "info" : "warn");

const databaseUrl = process.env.SONDARA_DATABASE_URL?.trim()
  ?? "postgresql://sondara:sondara@127.0.0.1:5433/sondara";
if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
  throw new Error("SONDARA_DATABASE_URL 必须是 PostgreSQL 连接地址。");
}

export const config = {
  host: process.env.SONDARA_API_HOST ?? "127.0.0.1",
  port: numberFromEnv(process.env.SONDARA_API_PORT, 4176),
  databaseDriver: "postgres" as const,
  databaseUrl,
  webOrigin: process.env.SONDARA_WEB_ORIGIN ?? "http://127.0.0.1:4175",
  sessionDays: numberFromEnv(process.env.SONDARA_SESSION_DAYS, 30),
  secureCookies: booleanFromEnv(process.env.SONDARA_SECURE_COOKIES),
  radarWorkerEnabled: booleanFromEnv(process.env.SONDARA_RADAR_WORKER_ENABLED, true),
  radarWorkerIntervalMs: numberFromEnv(
    process.env.SONDARA_RADAR_WORKER_INTERVAL_MS,
    2000,
  ),
  outboxWorkerEnabled: booleanFromEnv(process.env.SONDARA_OUTBOX_WORKER_ENABLED, true),
  outboxWorkerIntervalMs: numberFromEnv(
    process.env.SONDARA_OUTBOX_WORKER_INTERVAL_MS,
    5000,
  ),
  backupEnabled: booleanFromEnv(process.env.SONDARA_BACKUP_ENABLED),
  backupIntervalMs: numberFromEnv(process.env.SONDARA_BACKUP_INTERVAL_MS, 86_400_000),
  backupRetentionCount: numberFromEnv(process.env.SONDARA_BACKUP_RETENTION_COUNT, 7),
  backupDirectory: process.env.SONDARA_BACKUP_DIRECTORY?.trim() ?? resolve(process.cwd(), "data", "backups"),
  imapEnabled: booleanFromEnv(process.env.SONDARA_IMAP_ENABLED, true),
  imapHost: process.env.SONDARA_IMAP_HOST?.trim() ?? "",
  imapPort: numberFromEnv(process.env.SONDARA_IMAP_PORT, 993),
  imapUser: process.env.SONDARA_IMAP_USER?.trim() ?? "",
  imapPassword: process.env.SONDARA_IMAP_PASSWORD ?? "",
  imapPollIntervalMs: numberFromEnv(process.env.SONDARA_IMAP_POLL_INTERVAL_MS, 60_000),
  allowPrivateConnectors: booleanFromEnv(process.env.SONDARA_ALLOW_PRIVATE_CONNECTORS),
  trustProxy: booleanFromEnv(process.env.SONDARA_TRUST_PROXY),
  rateLimitMax: numberFromEnv(process.env.SONDARA_RATE_LIMIT_MAX, 300),
  logLevel,
  isProduction: process.env.NODE_ENV === "production",
  version: process.env.SONDARA_VERSION ?? "0.1.0",
  sentryDsn: process.env.SONDARA_SENTRY_DSN?.trim() ?? "",
  sentryTracesSampleRate: (() => { const parsed = Number(process.env.SONDARA_SENTRY_TRACES_SAMPLE_RATE); return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.1; })(),
  otelExporterOtlpEndpoint: process.env.SONDARA_OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim() ?? "",
  otelServiceName: process.env.SONDARA_OTEL_SERVICE_NAME?.trim() ?? process.env.OTEL_SERVICE_NAME?.trim() ?? "sondara",
} as const;
