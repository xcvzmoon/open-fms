import { createHash } from 'node:crypto';

export type StreamHashResult = {
  sha256: Buffer;
  sizeBytes: number;
};

export async function hashByteStream(
  stream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<StreamHashResult> {
  const hash = createHash('sha256');
  let sizeBytes = 0;
  for await (const chunk of stream) {
    hash.update(chunk);
    sizeBytes += chunk.length;
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
