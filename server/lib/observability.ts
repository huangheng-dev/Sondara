const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

type OptionalErrorReporter = {
  captureException: (error: unknown) => void;
  shutdown: () => Promise<void>;
};

const reporters: OptionalErrorReporter[] = [];

const loadModule = async (specifier: string) => {
  try {
    return await import(/* @vite-ignore */ specifier);
  } catch (error) {
    console.warn(`[observability] Optional package not available: ${specifier}`, error instanceof Error ? error.message : error);
    return null;
  }
};

export const initObservability = async (input: {
  sentryDsn: string;
  sentryTracesSampleRate: number;
  otelExporterOtlpEndpoint: string;
  otelServiceName: string;
  version: string;
  environment: string;
}) => {
  if (input.sentryDsn) {
    const moduleName = "@sentry/node";
    const Sentry = await loadModule(moduleName);
    if (Sentry) {
      const init = isRecord(Sentry) && typeof Sentry.init === "function"
        ? Sentry.init.bind(Sentry)
        : isRecord(Sentry) && isRecord(Sentry.default) && typeof Sentry.default.init === "function"
          ? Sentry.default.init.bind(Sentry.default)
          : null;
      const captureException = isRecord(Sentry) && typeof Sentry.captureException === "function"
        ? Sentry.captureException.bind(Sentry)
        : isRecord(Sentry) && isRecord(Sentry.default) && typeof Sentry.default.captureException === "function"
          ? Sentry.default.captureException.bind(Sentry.default)
          : null;
      const flush = isRecord(Sentry) && typeof Sentry.flush === "function"
        ? Sentry.flush.bind(Sentry)
        : isRecord(Sentry) && isRecord(Sentry.default) && typeof Sentry.default.flush === "function"
          ? Sentry.default.flush.bind(Sentry.default)
          : null;
      if (init && captureException) {
        init({
          dsn: input.sentryDsn,
          environment: input.environment,
          release: input.version,
          tracesSampleRate: input.sentryTracesSampleRate,
        });
        reporters.push({ captureException, shutdown: async () => { await flush?.(2_000); } });
        console.info(`[observability] Sentry enabled for ${input.environment}`);
      }
    }
  }

  if (input.otelExporterOtlpEndpoint) {
    const [sdkModule, instrumentationsModule, exporterModule, resourceModule, semanticModule] = await Promise.all([
      loadModule("@opentelemetry/sdk-node"),
      loadModule("@opentelemetry/auto-instrumentations-node"),
      loadModule("@opentelemetry/exporter-trace-otlp-http"),
      loadModule("@opentelemetry/resources"),
      loadModule("@opentelemetry/semantic-conventions"),
    ]);
    const NodeSDK = isRecord(sdkModule) ? (sdkModule.NodeSDK as { new (options: unknown): { start: () => void; shutdown: () => Promise<void> } } | undefined) : undefined;
    const getNodeAutoInstrumentations = isRecord(instrumentationsModule)
      ? (instrumentationsModule.getNodeAutoInstrumentations as () => unknown)
      : isRecord(instrumentationsModule) && isRecord(instrumentationsModule.default)
        ? (instrumentationsModule.default.getNodeAutoInstrumentations as () => unknown)
        : undefined;
    const OTLPTraceExporter = isRecord(exporterModule)
      ? (exporterModule.OTLPTraceExporter as { new (options: { url: string }): unknown } | undefined)
      : undefined;
    const Resource = isRecord(resourceModule)
      ? (resourceModule.Resource as { new (attrs: Record<string, string>): unknown } | undefined)
      : undefined;
    const SemanticResourceAttributes = isRecord(semanticModule)
      ? semanticModule.SemanticResourceAttributes as Record<string, string> | undefined
      : undefined;
    if (NodeSDK && getNodeAutoInstrumentations && OTLPTraceExporter && Resource && SemanticResourceAttributes) {
      const traceExporter = new OTLPTraceExporter({ url: input.otelExporterOtlpEndpoint });
      const resource = new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: input.otelServiceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: input.version,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: input.environment,
      });
      const sdk = new NodeSDK({ traceExporter, resource, instrumentations: [getNodeAutoInstrumentations()] });
      sdk.start();
      reporters.push({ captureException: () => {}, shutdown: async () => { await sdk.shutdown(); } });
      console.info(`[observability] OpenTelemetry traces exporting to ${input.otelExporterOtlpEndpoint}`);
    }
  }
};

export const captureObservabilityException = (error: unknown) => {
  for (const reporter of reporters) {
    try {
      reporter.captureException(error);
    } catch {
      // Observability must never break request handling.
    }
  }
};

export const shutdownObservability = async () => {
  await Promise.allSettled(reporters.map(async reporter => reporter.shutdown()));
};
