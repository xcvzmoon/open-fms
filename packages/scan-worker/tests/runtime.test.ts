import { access } from 'node:fs/promises';
import { expect, test } from 'vite-plus/test';
import { parseWorkerConfig } from '../src/config.ts';
import { runWorkerLoop } from '../src/loop.ts';
import { spoolObject } from '../src/spool.ts';

test('configuration requires antivirus and does not disclose input', () => {
  expect(() => parseWorkerConfig({ S3_SECRET_ACCESS_KEY: 'private' })).toThrow(
    'SCAN_CONFIG_INVALID',
  );
});
test('poll cancellation interrupts idle wait', async () => {
  const controller = new AbortController();
  let calls = 0;
  const running = runWorkerLoop(
    () => {
      calls += 1;
      setTimeout(() => {
        controller.abort();
      }, 5);
      return Promise.resolve({ status: 'skipped' as const, reason: null });
    },
    controller.signal,
    60000,
  );
  await running;
  expect(calls).toBe(1);
});
test('spools streamed bytes, hashes and removes private temporary file', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.from('hello'));
      controller.close();
    },
  });
  const result = await spoolObject(body, 5, new AbortController().signal);
  expect(result.sizeBytes).toBe(5);
  expect(result.sha256.toString('hex')).toBe(
    '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
  );
  await result.cleanup();
  await expect(access(result.path)).rejects.toThrow();
});
test('spooling rejects oversized input', async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Buffer.alloc(10));
      controller.close();
    },
  });
  await expect(spoolObject(body, 5, new AbortController().signal)).rejects.toThrow(
    'SCAN_SIZE_LIMIT',
  );
});

test('heartbeat cancels on lost lease and bounded renewal deadline', async () => {
  const { maintainLease } = await import('../src/lease.ts');
  let lost = 0;
  const stop = new AbortController();
  await maintainLease(
    () => Promise.resolve(false),
    15,
    () => {
      lost += 1;
    },
    stop.signal,
  );
  expect(lost).toBe(1);
  await maintainLease(
    () => new Promise<boolean>(() => {}),
    15,
    () => {
      lost += 1;
    },
    stop.signal,
  );
  expect(lost).toBe(2);
});
