import { createHash } from 'node:crypto';

export type StreamHashResult = {
  sha256: Buffer;
  sizeBytes: number;
};

export async function hashByteStream(
  stream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  maximumBytes = Number.MAX_SAFE_INTEGER,
): Promise<StreamHashResult> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of stream) {
    sizeBytes += chunk.length;
    if (sizeBytes > maximumBytes) throw new Error('UPLOAD_SIZE_MISMATCH');
    hash.update(chunk);
  }
  return {
    sha256: hash.digest(),
    sizeBytes,
  };
}

export function hashBuffer(buffer: Uint8Array): StreamHashResult {
  const hash = createHash('sha256');
  hash.update(buffer);
  return {
    sha256: hash.digest(),
    sizeBytes: buffer.length,
  };
}
