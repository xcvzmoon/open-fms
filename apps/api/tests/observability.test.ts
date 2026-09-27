import { describe, expect, test } from 'vite-plus/test';
import { runProcessCanary } from '../server/observability/canary.ts';
import { resolveOtelConfig } from '../server/observability/otel.ts';

describe('process canary', () => {
  test('returns ok for a healthy process', () => {
    const result = runProcessCanary();
    expect(result.status).toBe('ok');
    expect(result.detail).toContain('ns:');
  });
});

describe('resolveOtelConfig', () => {
  test('is disabled by default', () => {
    const config = resolveOtelConfig({});
    expect(config.enabled).toBe(false);
    expect(config.serviceName).toBe('open-fms-api');
  });

  test('enables otel and reads endpoint', () => {
    const config = resolveOtelConfig({
      OTEL_ENABLED: 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_SERVICE_NAME: 'open-fms',
    });
    expect(config.enabled).toBe(true);
    expect(config.otlpEndpoint).toBe('http://localhost:4318');
    expect(config.serviceName).toBe('open-fms');
  });
});
