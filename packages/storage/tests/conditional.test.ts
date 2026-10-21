import { getEventListeners } from 'node:events';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import { createStorageAdapter, isObjectNotFound } from '../src/index.ts';

const requests: {
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}[] = [];
const server = createServer((request, response) => {
  requests.push({ method: request.method, url: request.url, headers: request.headers });
  request.resume();
  if (request.url?.includes('cancel-request')) return;
  if (request.url?.includes('gone-upload')) {
    response.writeHead(404, { 'content-type': 'application/xml' });
    response.end(
      '<Error><Code>NoSuchUpload</Code><Message>Upload no longer exists</Message></Error>',
    );
    return;
  }
  if (request.url?.includes('missing')) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (request.url?.includes('forbidden')) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (request.method === 'PUT' && request.headers['x-amz-copy-source']) {
    response.setHeader('content-type', 'application/xml');
    response.end('<CopyObjectResult><ETag>"copy"</ETag></CopyObjectResult>');
    return;
  }
  response.setHeader('etag', '"fixture"');
  response.end(request.method === 'GET' ? 'body' : undefined);
});
let adapter: ReturnType<typeof createStorageAdapter>;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || !(address instanceof Object)) throw new Error('FIXTURE_ADDRESS_MISSING');
  adapter = createStorageAdapter({
    config: {
      id: 'fixture',
      name: 'fixture',
      kind: 's3',
      endpoint: `http://127.0.0.1:${address.port}`,
      region: 'us-east-1',
      quarantineBucket: 'quarantine',
      cleanBucket: 'clean',
      forensicBucket: null,
      credentialRef: 'dummy',
      forcePathStyle: true,
    },
    credentials: { accessKeyId: 'dummy', secretAccessKey: 'dummy' },
  });
});
afterAll(async () => {
  adapter.destroy();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

test('sends If-Match on GET and consumes the response', async () => {
  const object = await adapter.getObject({ bucket: 'clean', key: 'file', expectedEtag: 'sealed' });
  expect(await new Response(object.body).text()).toBe('body');
  expect(requests.at(-1)?.headers['if-match']).toBe('sealed');
});
test('encodes copy source segments without losing slashes and sends the seal', async () => {
  await adapter.copyObject({
    sourceBucket: 'quarantine',
    sourceKey: "a folder/é+#?(')*!.txt",
    destinationBucket: 'clean',
    destinationKey: 'out',
    sourceEtag: 'sealed',
  });
  expect(requests.at(-1)?.headers['x-amz-copy-source']).toBe(
    'quarantine/a%20folder/%C3%A9%2B%23%3F%28%27%29%2A%21.txt',
  );
  expect(requests.at(-1)?.headers['x-amz-copy-source-if-match']).toBe('sealed');
});
test('uploads a bounded Node stream part with its length', async () => {
  await adapter.uploadPart({
    bucket: 'quarantine',
    key: 'part',
    uploadId: 'dummy',
    partNumber: 1,
    body: Readable.from([Buffer.from('abc')]),
    contentLength: 3,
  });
  expect(
    requests.at(-1)?.headers['x-amz-decoded-content-length'] ??
      requests.at(-1)?.headers['content-length'],
  ).toBe('3');
});
test('honors an already aborted GET and upload', async () => {
  const signal = AbortSignal.abort();
  await expect(
    adapter.getObject({ bucket: 'clean', key: 'file', abortSignal: signal }),
  ).rejects.toThrow();
  await expect(
    adapter.putObject({
      location: { bucket: 'clean', key: 'file' },
      body: Buffer.from('abc'),
      abortSignal: signal,
    }),
  ).rejects.toThrow();
});
test('only classifies SDK 404 responses as missing objects', async () => {
  for (const key of ['missing', 'forbidden']) {
    try {
      await adapter.headObject({ bucket: 'clean', key });
      throw new Error('expected fixture rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) expect(isObjectNotFound(error)).toBe(key === 'missing');
    }
  }
  expect(isObjectNotFound(new Error('NotFound'))).toBe(false);
});

test('aborts an upload waiting for source bytes and removes its abort listener', async () => {
  const controller = new AbortController();
  const body = new Readable({ read() {} });
  const upload = adapter.putObject({
    location: { bucket: 'clean', key: 'cancelled' },
    body,
    abortSignal: controller.signal,
  });
  const assertion = expect(upload).rejects.toThrow();
  controller.abort();
  await assertion;
  expect(body.destroyed).toBe(true);
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
});
test('removes the abort listener after a successful upload', async () => {
  const controller = new AbortController();
  await adapter.putObject({
    location: { bucket: 'clean', key: 'success' },
    body: Buffer.from('abc'),
    abortSignal: controller.signal,
  });
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
});

const cancellationOperations = [
  {
    name: 'HEAD',
    run: (signal: AbortSignal) =>
      adapter.headObject({ bucket: 'clean', key: 'cancel-request', abortSignal: signal }),
  },
  {
    name: 'copy',
    run: (signal: AbortSignal) =>
      adapter.copyObject({
        sourceBucket: 'quarantine',
        sourceKey: 'source',
        destinationBucket: 'clean',
        destinationKey: 'cancel-request',
        abortSignal: signal,
      }),
  },
  {
    name: 'delete',
    run: (signal: AbortSignal) =>
      adapter.deleteObject({ bucket: 'clean', key: 'cancel-request', abortSignal: signal }),
  },
  {
    name: 'create multipart',
    run: (signal: AbortSignal) =>
      adapter.createMultipartUpload({
        bucket: 'clean',
        key: 'cancel-request',
        abortSignal: signal,
      }),
  },
  {
    name: 'complete multipart',
    run: (signal: AbortSignal) =>
      adapter.completeMultipartUpload({
        bucket: 'clean',
        key: 'cancel-request',
        uploadId: 'dummy',
        parts: [{ partNumber: 1, etag: 'part' }],
        abortSignal: signal,
      }),
  },
  {
    name: 'abort multipart',
    run: (signal: AbortSignal) =>
      adapter.abortMultipartUpload({
        bucket: 'clean',
        key: 'cancel-request',
        uploadId: 'dummy',
        abortSignal: signal,
      }),
  },
];

test.each(cancellationOperations)(
  'cancels an in-flight $name request and closes its connection',
  async ({ run }) => {
    const controller = new AbortController();
    let connectionClosed: Promise<void> | undefined;
    const received = new Promise<void>((resolve) => {
      server.once('request', (_request, response) => {
        connectionClosed = new Promise<void>((closeResolve) =>
          response.once('close', closeResolve),
        );
        resolve();
      });
    });
    const request = run(controller.signal);
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    try {
      await received;
      controller.abort();
      await rejected;
      await connectionClosed;
    } finally {
      controller.abort();
    }
  },
);

test('treats an already removed multipart upload as successfully aborted', async () => {
  await expect(
    adapter.abortMultipartUpload({ bucket: 'clean', key: 'gone-upload', uploadId: 'gone' }),
  ).resolves.toBeUndefined();
});
