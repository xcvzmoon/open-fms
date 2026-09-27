export type CanaryResult = {
  status: 'ok' | 'skipped' | 'error';
  detail: string | null;
  checks: Record<string, 'ok' | 'skipped' | 'error'>;
};

export function runProcessCanary(): CanaryResult {
  const started = process.hrtime.bigint();
  const sample = Buffer.from('open-fms-canary').toString('base64url');
  const elapsedNs = Number(process.hrtime.bigint() - started);
  if (sample.length === 0 || elapsedNs < 0) {
    return {
      status: 'error',
      detail: 'canary_failed',
      checks: { process: 'error', storage: 'skipped' },
    };
  }
  return {
    status: 'ok',
    detail: `ns:${elapsedNs}`,
    checks: { process: 'ok', storage: 'skipped' },
  };
}

export type StorageCanaryInput = {
  enabled: boolean;
  head?: (() => Promise<void>) | undefined;
};

export async function runStorageCanary(input: StorageCanaryInput): Promise<CanaryResult> {
  const processResult = runProcessCanary();
  if (!input.enabled || !input.head) {
    return {
      ...processResult,
      checks: { ...processResult.checks, storage: 'skipped' },
    };
  }
  try {
    await input.head();
    return {
      status: 'ok',
      detail: processResult.detail,
      checks: { process: 'ok', storage: 'ok' },
    };
  } catch (error) {
    return {
      status: 'error',
      detail: error instanceof Error ? error.message : 'storage_canary_failed',
      checks: { process: 'ok', storage: 'error' },
    };
  }
}
