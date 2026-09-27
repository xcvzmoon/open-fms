export type CanaryResult = {
  status: 'ok' | 'skipped' | 'error';
  detail: string | null;
};

/**
 * Lightweight process-level canary. Full upload/scan/download canary
 * depends on a configured storage backend and is enabled in T16.
 */
export function runProcessCanary(): CanaryResult {
  const started = process.hrtime.bigint();
  const sample = Buffer.from('open-fms-canary').toString('base64url');
  const elapsedNs = Number(process.hrtime.bigint() - started);
  if (sample.length === 0 || elapsedNs < 0) {
    return { status: 'error', detail: 'canary_failed' };
  }
  return { status: 'ok', detail: `ns:${elapsedNs}` };
}
