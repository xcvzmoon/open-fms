import type { StreamHashResult } from './hash.ts';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

export type HashedUpload = { body: Readable; result(): StreamHashResult };

export function hashUploadBody(
  stream: ReadableStream<Uint8Array>,
  expectedBytes: number,
  signal: AbortSignal,
): HashedUpload {
  const reader = stream.getReader();
  const hash = createHash('sha256');
  let sizeBytes = 0;
  let result: StreamHashResult | undefined;
  function abort(): void {
    void reader.cancel(signal.reason).catch(() => {});
  }
  signal.addEventListener('abort', abort, { once: true });
  async function* chunks(): AsyncGenerator<Uint8Array> {
    try {
      signal.throwIfAborted();
      while (true) {
        // oxlint-disable-next-line no-await-in-loop -- Read one chunk at a time to preserve backpressure and enforce the byte limit.
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        sizeBytes += next.value.byteLength;
        if (sizeBytes > expectedBytes) throw new Error('UPLOAD_SIZE_MISMATCH');
        hash.update(next.value);
        yield next.value;
      }
      if (sizeBytes !== expectedBytes) throw new Error('UPLOAD_SIZE_MISMATCH');
      result = { sha256: hash.digest(), sizeBytes };
    } finally {
      signal.removeEventListener('abort', abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  return {
    body: Readable.from(chunks(), { objectMode: false, highWaterMark: 64 * 1024 }),
    result() {
      if (!result) throw new Error('UPLOAD_BODY_INCOMPLETE');
      return result;
    },
  };
}

export async function readPartBody(
  stream: ReadableStream<Uint8Array>,
  limit: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  function abort(): void {
    void reader.cancel(signal.reason).catch(() => {});
  }
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- Read one chunk at a time to preserve backpressure and enforce the byte limit.
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) throw new Error('UPLOAD_PART_TOO_LARGE');
      chunks.push(next.value);
    }
    if (!size) throw new Error('UPLOAD_BODY_MISSING');
    return Buffer.concat(chunks, size);
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

let activeUploads = 0;
const activeByCaller = new Map<string, number>();
export async function withUploadCapacity<T>(
  callerId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const callerActive = activeByCaller.get(callerId) ?? 0;
  if (activeUploads >= 4 || callerActive >= 2) throw new Error('UPLOAD_CAPACITY_EXCEEDED');
  activeUploads += 1;
  activeByCaller.set(callerId, callerActive + 1);
  try {
    return await operation();
  } finally {
    activeUploads -= 1;
    const remaining = (activeByCaller.get(callerId) ?? 1) - 1;
    if (remaining) activeByCaller.set(callerId, remaining);
    else activeByCaller.delete(callerId);
  }
}
