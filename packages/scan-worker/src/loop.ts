import type { ScanOutcome } from './worker.ts';
import { setTimeout as delay } from 'node:timers/promises';

export async function runWorkerLoop(
  processNext: () => Promise<ScanOutcome>,
  signal: AbortSignal,
  pollIntervalMs: number,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const outcome = await processNext();
      failures = outcome.status === 'failed' ? Math.min(failures + 1, 6) : 0;
      if (outcome.status !== 'skipped' && outcome.status !== 'failed') continue;
    } catch {
      failures = Math.min(failures + 1, 6);
    }
    try {
      await delay(Math.min(60_000, pollIntervalMs * 2 ** failures), undefined, { signal });
    } catch {
      if (!signal.aborted) throw new Error('SCAN_POLL_FAILED');
    }
  }
}
