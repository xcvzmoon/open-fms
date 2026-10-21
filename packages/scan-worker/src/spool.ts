import { createHash } from 'node:crypto';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function spoolObject(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
): Promise<{
  path: string;
  sizeBytes: number;
  sha256: Buffer;
  prefix: Buffer;
  cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'fms-scan-'));
  const path = join(directory, 'object');
  const cleanup = () => rm(directory, { recursive: true, force: true });
  const reader = body.getReader();
  const hash = createHash('sha256');
  const prefix = Buffer.alloc(8192);
  let sizeBytes = 0;
  let prefixLength = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    const file = await open(path, 'wx', 0o600);
    try {
      while (true) {
        signal.throwIfAborted();
        // oxlint-disable-next-line no-await-in-loop -- Read and persist one chunk at a time to bound memory and preserve byte order.
        const result = await reader.read();
        signal.throwIfAborted();
        if (result.done) break;
        sizeBytes += result.value.length;
        if (sizeBytes > maxBytes) throw new Error('SCAN_SIZE_LIMIT');
        hash.update(result.value);
        const copied = Math.min(prefix.length - prefixLength, result.value.length);
        prefix.set(result.value.subarray(0, copied), prefixLength);
        prefixLength += copied;
        // oxlint-disable-next-line no-await-in-loop -- Read and persist one chunk at a time to bound memory and preserve byte order.
        await file.writeFile(result.value);
      }
    } finally {
      await file.close();
    }
    return {
      path,
      sizeBytes,
      sha256: hash.digest(),
      prefix: prefix.subarray(0, prefixLength),
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
