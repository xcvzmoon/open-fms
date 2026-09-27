export type OtelBootstrapConfig = {
  enabled: boolean;
  otlpEndpoint?: string | undefined;
  serviceName: string;
};

export function resolveOtelConfig(
  source: Record<string, string | undefined> = process.env,
): OtelBootstrapConfig {
  return {
    enabled: source.OTEL_ENABLED === 'true',
    otlpEndpoint: source.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: source.OTEL_SERVICE_NAME ?? 'open-fms-api',
  };
}

/**
 * Starts the NodeSDK when OTEL_ENABLED=true. Import from a Nitro plugin
 * before routes serve traffic.
 */
export async function bootstrapOtel(): Promise<() => Promise<void>> {
  const config = resolveOtelConfig();
  if (!config.enabled) {
    return async () => {};
  }

  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');

  const sdkOptions: ConstructorParameters<typeof NodeSDK>[0] = {
    serviceName: config.serviceName,
  };
  if (config.otlpEndpoint) {
    sdkOptions.traceExporter = new OTLPTraceExporter({
      url: `${config.otlpEndpoint.replace(/\/$/, '')}/v1/traces`,
    });
  }

  const sdk = new NodeSDK(sdkOptions);
  sdk.start();

  return async () => {
    await sdk.shutdown();
  };
}
