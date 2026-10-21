import { expect, test } from 'vite-plus/test';
import { closeBody } from '../src/stream.ts';

test('closes once after the response stream finishes', async () => {
  let closes = 0;
  const body = closeBody(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.close();
      },
    }),
    () => {
      closes += 1;
    },
  );
  expect(new Uint8Array(await new Response(body).arrayBuffer())).toEqual(new Uint8Array([1, 2]));
  expect(closes).toBe(1);
});

test('cancels the source and closes once when the consumer disconnects', async () => {
  let closes = 0;
  let cancelled = '';
  const body = closeBody(
    new ReadableStream<Uint8Array>({
      cancel(reason: string) {
        cancelled = reason;
      },
    }),
    () => {
      closes += 1;
    },
  );
  await body.cancel('disconnect');
  expect(cancelled).toBe('disconnect');
  expect(closes).toBe(1);
});

test('closes the client when the source errors', async () => {
  let closes = 0;
  const body = closeBody(
    new ReadableStream<Uint8Array>({
      pull() {
        throw new Error('broken upstream');
      },
    }),
    () => {
      closes += 1;
    },
  );
  await expect(new Response(body).arrayBuffer()).rejects.toThrow('broken upstream');
  expect(closes).toBe(1);
});

test('closes even when source cancellation fails', async () => {
  let closes = 0;
  const body = closeBody(
    new ReadableStream<Uint8Array>({
      cancel() {
        throw new Error('cancel failed');
      },
    }),
    () => {
      closes += 1;
    },
  );
  await expect(body.cancel()).rejects.toThrow('cancel failed');
  expect(closes).toBe(1);
});
