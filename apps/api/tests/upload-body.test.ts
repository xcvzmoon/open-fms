import type { Readable } from 'node:stream';
import { describe, expect, test } from 'vite-plus/test';
import { hashUploadBody, readPartBody, withUploadCapacity } from '../server/uploads/body.ts';

function bytes(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}
async function drain(body: Readable): Promise<void> {
  for await (const chunk of body) {
    void chunk;
  }
}

describe('bounded upload bodies', () => {
  test('hashes a streamed exact body', async () => {
    const upload = hashUploadBody(bytes([1, 2], [3]), 3, new AbortController().signal);
    await drain(upload.body);
    expect(upload.result().sizeBytes).toBe(3);
    expect(upload.result().sha256.toString('hex')).toBe(
      '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81',
    );
  });
  test.each([2, 4])('rejects a body that differs from %s declared bytes', async (expected) => {
    const upload = hashUploadBody(bytes([1, 2, 3]), expected, new AbortController().signal);
    await expect(drain(upload.body)).rejects.toThrow('UPLOAD_SIZE_MISMATCH');
    expect(() => upload.result()).toThrow('UPLOAD_BODY_INCOMPLETE');
  });
  test('caps multipart bytes', async () => {
    await expect(readPartBody(bytes([1, 2], [3]), 2, new AbortController().signal)).rejects.toThrow(
      'UPLOAD_PART_TOO_LARGE',
    );
  });
  test('aborts an incomplete stream', async () => {
    const controller = new AbortController();
    const upload = hashUploadBody(new ReadableStream(), 1, controller.signal);
    const drained = drain(upload.body);
    controller.abort(new Error('cancelled'));
    await expect(drained).rejects.toThrow('cancelled');
  });
  test('bounds concurrent admission and releases failed work', async () => {
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = [1, 2, 3, 4].map((index) => withUploadCapacity(String(index), () => pending));
    await expect(withUploadCapacity('other', () => Promise.resolve())).rejects.toThrow(
      'UPLOAD_CAPACITY_EXCEEDED',
    );
    release?.();
    await Promise.all(active);
    await expect(
      withUploadCapacity('other', () => Promise.reject(new Error('failed'))),
    ).rejects.toThrow('failed');
    await withUploadCapacity('other', () => Promise.resolve());
  });
});
