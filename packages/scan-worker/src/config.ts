import type { ScanWorkerConfig } from './worker.ts';
import { randomUUID } from 'node:crypto';
import * as v from 'valibot';

function integer(defaultValue: string, maximum: number) {
  return v.pipe(
    v.optional(v.string(), defaultValue),
    v.regex(/^\d+$/),
    v.transform(Number),
    v.integer(),
    v.minValue(1),
    v.maxValue(maximum),
  );
}
const configSchema = v.object({
  SCAN_WORKER_ID: v.optional(v.pipe(v.string(), v.minLength(1)), () => randomUUID()),
  S3_ACCESS_KEY_ID: v.pipe(v.string(), v.minLength(1)),
  S3_SECRET_ACCESS_KEY: v.pipe(v.string(), v.minLength(1)),
  S3_SESSION_TOKEN: v.optional(v.string()),
  CLAMAV_HOST: v.pipe(v.string(), v.minLength(1)),
  CLAMAV_PORT: integer('3310', 65535),
  SCAN_CLAMAV_TIMEOUT_MS: integer('30000', 300000),
  SCAN_MAX_FILE_BYTES: integer('1073741824', Number.MAX_SAFE_INTEGER),
  SCAN_LEASE_MS: v.pipe(integer('300000', 3600000), v.minValue(3000)),
  SCAN_JOB_TIMEOUT_MS: integer('600000', 3600000),
  SCAN_POLL_INTERVAL_MS: integer('1000', 60000),
});
export function parseWorkerConfig(environment: NodeJS.ProcessEnv): ScanWorkerConfig {
  const parsed = v.safeParse(configSchema, environment);
  if (!parsed.success) throw new Error('SCAN_CONFIG_INVALID');
  const config = parsed.output;
  return {
    workerId: config.SCAN_WORKER_ID,
    storageCredentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
      sessionToken: config.S3_SESSION_TOKEN,
    },
    clamAv: {
      host: config.CLAMAV_HOST,
      port: config.CLAMAV_PORT,
      timeoutMs: config.SCAN_CLAMAV_TIMEOUT_MS,
    },
    maxFileBytes: config.SCAN_MAX_FILE_BYTES,
    leaseMs: config.SCAN_LEASE_MS,
    jobTimeoutMs: config.SCAN_JOB_TIMEOUT_MS,
    pollIntervalMs: config.SCAN_POLL_INTERVAL_MS,
  };
}
