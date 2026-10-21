import type { Server, Socket } from 'node:net';
import { createServer } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, expect, test } from 'vite-plus/test';
import { createClamAvClient } from '../src/clamav.ts';

const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) =>
          server.close(() => {
            resolve();
          }),
        ),
    ),
  );
});
async function service(handle: (socket: Socket) => void): Promise<number> {
  const server = createServer((socket) => {
    sockets.push(socket);
    handle(socket);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || !(address instanceof Object)) throw new Error('TEST_ADDRESS');
  return address.port;
}
test('sends null framed INSTREAM with network byte lengths and handles fragmented response', async () => {
  const chunks: Buffer[] = [];
  const port = await service((socket) => {
    socket.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
      const received = Buffer.concat(chunks);
      if (received.length === 23) {
        socket.write('stream: O');
        setTimeout(() => socket.write('K\0'), 5);
      }
    });
  });
  const result = await createClamAvClient({ host: '127.0.0.1', port, timeoutMs: 1000 }).scanStream(
    Readable.from([Buffer.from('hello')]),
    new AbortController().signal,
  );
  expect(result.status).toBe('clean');
  expect(Buffer.concat(chunks)).toEqual(
    Buffer.concat([
      Buffer.from('zINSTREAM\0'),
      Buffer.from([0, 0, 0, 5]),
      Buffer.from('hello'),
      Buffer.alloc(4),
    ]),
  );
});
test('fails closed on premature end', async () => {
  const port = await service((socket) => socket.end('stream: OK'));
  const result = await createClamAvClient({ host: '127.0.0.1', port }).scanStream(
    Readable.from([]),
    new AbortController().signal,
  );
  expect(result.status).toBe('error');
});
test('bounds a silent service by deadline and supports cancellation', async () => {
  const port = await service(() => {});
  const client = createClamAvClient({ host: '127.0.0.1', port, timeoutMs: 20 });
  expect((await client.scanStream(Readable.from([]), new AbortController().signal)).detail).toBe(
    'SCAN_CLAMAV_TIMEOUT',
  );
  const controller = new AbortController();
  controller.abort();
  expect((await client.scanStream(Readable.from([]), controller.signal)).detail).toBe(
    'SCAN_ABORTED',
  );
});
test('reports infection and daemon errors', async () => {
  const port = await service((socket) =>
    socket.once('data', () => socket.end('stream: Eicar-Test-Signature FOUND\0')),
  );
  expect(
    (
      await createClamAvClient({ host: '127.0.0.1', port }).scanStream(
        Readable.from([]),
        new AbortController().signal,
      )
    ).signature,
  ).toBe('Eicar-Test-Signature');
});
