import { config } from "./config.js";
import { initObservability } from "./lib/observability.js";

await initObservability({
  sentryDsn: config.sentryDsn,
  sentryTracesSampleRate: config.sentryTracesSampleRate,
  otelExporterOtlpEndpoint: config.otelExporterOtlpEndpoint,
  otelServiceName: config.otelServiceName,
  version: config.version,
  environment: config.isProduction ? "production" : "development",
});
