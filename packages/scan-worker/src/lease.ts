import { setTimeout as delay } from 'node:timers/promises';

export async function maintainLease(
  renew: () => Promise<boolean>,
  leaseMs: number,
  lost: () => void,
  stop: AbortSignal,
): Promise<void> {
  try {
    while (!stop.aborted) {
      await delay(Math.floor(leaseMs / 3), undefined, { signal: stop });
      const renewed = await Promise.race([
        renew(),
        delay(Math.floor(leaseMs / 3), false, { signal: stop }),
      ]);
      if (!renewed) {
        lost();
        return;
      }
    }
  } catch {
    if (!stop.aborted) lost();
  }
}
