import type { ObjectLocation, S3StorageAdapter, StorageBackendConfig } from '../src/index.ts';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createStorageAdapter } from '../src/index.ts';
import { ensureTestBuckets } from './ensure-buckets.ts';

const endpoint = process.env.STORAGE_TEST_ENDPOINT;

const accessKeyId = process.env.STORAGE_TEST_ACCESS_KEY_ID ?? 'minioadmin';
const secretAccessKey = process.env.STORAGE_TEST_SECRET_ACCESS_KEY ?? 'minioadmin';
const region = process.env.STORAGE_TEST_REGION ?? 'us-east-1';
const forcePathStyle = process.env.STORAGE_TEST_FORCE_PATH_STYLE !== 'false';

const quarantineBucket = process.env.STORAGE_TEST_QUARANTINE_BUCKET ?? 'fms-quarantine';
const cleanBucket = process.env.STORAGE_TEST_CLEAN_BUCKET ?? 'fms-clean';
const forensicBucket = process.env.STORAGE_TEST_FORENSIC_BUCKET ?? 'fms-forensic';

const config: StorageBackendConfig = {
  id: 'storage-test',
  name: 'storage-test',
  kind: 'minio',
  endpoint: endpoint ?? 'http://127.0.0.1:9000',
  region,
  quarantineBucket,
  cleanBucket,
  forensicBucket,
  credentialRef: 'env:storage-test',
  forcePathStyle,
};

function testKey(prefix: string): string {
  return `${prefix}/${crypto.randomUUID()}`;
}

async function readBody(stream: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

async function deleteQuietly(storage: S3StorageAdapter, location: ObjectLocation): Promise<void> {
  try {
    await storage.deleteObject(location);
  } catch {
    // Cleanup is best-effort so one failed delete does not mask the assertion.
  }
}

describe.skipIf(!endpoint)('S3StorageAdapter against a real backend', () => {
  let storage: S3StorageAdapter;
  const cleanupKeys: ObjectLocation[] = [];

  function track(bucket: string, key: string): ObjectLocation {
    const location = { bucket, key };
    cleanupKeys.push(location);
    return location;
  }

  beforeAll(async () => {
    await ensureTestBuckets({
      config,
      credentials: { accessKeyId, secretAccessKey },
    });
    storage = createStorageAdapter({
      config,
      credentials: { accessKeyId, secretAccessKey },
    });
  });

  afterAll(async () => {
    await Promise.all(cleanupKeys.map((location) => deleteQuietly(storage, location)));
    storage.destroy();
  });

  test('exposes backend identity and bucket names', () => {
    expect(storage.backendId).toBe('storage-test');
    expect(storage.quarantineBucket).toBe(quarantineBucket);
    expect(storage.cleanBucket).toBe(cleanBucket);
    expect(storage.forensicBucket).toBe(forensicBucket);
  });

  test('putObject, headObject, and getObject preserve bytes and etag', async () => {
    const payload = encode('open-fms put/get payload');
    const location = track(quarantineBucket, testKey('integration/put-get'));

    const put = await storage.putObject({
      location,
      body: payload,
      contentType: 'application/octet-stream',
      contentLength: payload.byteLength,
      metadata: { suite: 'storage-integration' },
    });
    expect(put.etag).not.toBe('');
    expect(put.etag).not.toContain('"');

    const head = await storage.headObject(location);
    expect(head.contentLength).toBe(payload.byteLength);
    expect(head.etag).toBe(put.etag);
    expect(head.contentType).toBe('application/octet-stream');
    expect(head.lastModified).toBeInstanceOf(Date);

    const got = await storage.getObject(location);
    const bytes = await readBody(got.body);
    expect(bytes).toEqual(payload);
    expect(got.etag).toBe(put.etag);
    expect(got.contentLength).toBe(payload.byteLength);
    expect(got.contentRange).toBeUndefined();
  });

  test('putObject accepts string bodies', async () => {
    const location = track(quarantineBucket, testKey('integration/put-string'));
    const body = 'string body payload';

    await storage.putObject({
      location,
      body,
      contentType: 'text/plain',
    });

    const got = await storage.getObject(location);
    const bytes = await readBody(got.body);
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  test('putObject accepts Readable stream bodies', async () => {
    const location = track(quarantineBucket, testKey('integration/put-stream'));
    const body = 'stream body payload';

    await storage.putObject({
      location,
      body: Readable.from([Buffer.from(body)]),
      contentType: 'application/octet-stream',
    });

    const got = await storage.getObject(location);
    const bytes = await readBody(got.body);
    expect(new TextDecoder().decode(bytes)).toBe(body);
  });

  test('putObject uses multipart under the hood for bodies over 8 MiB', async () => {
    const location = track(cleanBucket, testKey('integration/put-large'));
    const payload = new Uint8Array(8 * 1024 * 1024 + 128).fill(0x7a);

    const put = await storage.putObject({
      location,
      body: payload,
      contentType: 'application/octet-stream',
      contentLength: payload.byteLength,
    });
    // Multipart etags are `md5-of-md5s-N`, unlike single-part md5 etags.
    expect(put.etag).toMatch(/-\d+$/);

    const head = await storage.headObject(location);
    expect(head.contentLength).toBe(payload.byteLength);
    expect(head.etag).toBe(put.etag);

    const got = await storage.getObject(location);
    const bytes = await readBody(got.body);
    expect(bytes.byteLength).toBe(payload.byteLength);
    expect(bytes[0]).toBe(0x7a);
    expect(bytes[bytes.byteLength - 1]).toBe(0x7a);
    expect(head.etag).toBe(put.etag);
  });

  test('getObject honors mid-object byte ranges', async () => {
    const payload = encode('0123456789abcdefghij');
    const location = track(quarantineBucket, testKey('integration/range-mid'));

    await storage.putObject({
      location,
      body: payload,
      contentType: 'application/octet-stream',
    });

    const ranged = await storage.getObject({
      ...location,
      range: 'bytes=5-9',
    });
    const bytes = await readBody(ranged.body);
    expect(new TextDecoder().decode(bytes)).toBe('56789');
    expect(ranged.contentLength).toBe(5);
    expect(ranged.contentRange).toBe('bytes 5-9/20');
    expect(ranged.etag).not.toBe('');
  });

  test('getObject honors single-byte and open-ended ranges', async () => {
    const payload = encode('0123456789abcdefghij');
    const location = track(quarantineBucket, testKey('integration/range-edges'));

    await storage.putObject({
      location,
      body: payload,
      contentType: 'application/octet-stream',
    });

    const firstByte = await storage.getObject({
      ...location,
      range: 'bytes=0-0',
    });
    expect(new TextDecoder().decode(await readBody(firstByte.body))).toBe('0');
    expect(firstByte.contentRange).toBe('bytes 0-0/20');

    const tail = await storage.getObject({
      ...location,
      range: 'bytes=15-',
    });
    expect(new TextDecoder().decode(await readBody(tail.body))).toBe('fghij');
    expect(tail.contentRange).toBe('bytes 15-19/20');
  });

  test('getObject and headObject throw for missing keys', async () => {
    const location = track(quarantineBucket, testKey('integration/missing'));

    await expect(storage.headObject(location)).rejects.toThrow();
    await expect(storage.getObject(location)).rejects.toThrow();
  });

  test('copyObject promotes an object and leaves the source intact', async () => {
    const payload = encode('promote me');
    const source = track(quarantineBucket, testKey('integration/copy-source'));
    const destination = track(cleanBucket, testKey('integration/copy-dest'));

    const put = await storage.putObject({
      location: source,
      body: payload,
      contentType: 'application/octet-stream',
    });

    const copied = await storage.copyObject({
      sourceBucket: source.bucket,
      sourceKey: source.key,
      destinationBucket: destination.bucket,
      destinationKey: destination.key,
    });
    expect(copied.etag).toBe(put.etag);

    const destinationHead = await storage.headObject(destination);
    expect(destinationHead.etag).toBe(put.etag);
    expect(destinationHead.contentLength).toBe(payload.byteLength);

    const sourceHead = await storage.headObject(source);
    expect(sourceHead.etag).toBe(put.etag);
  });

  test('copyObject throws when the source is missing', async () => {
    const sourceKey = testKey('integration/copy-missing-source');
    const destination = track(cleanBucket, testKey('integration/copy-missing-dest'));

    await expect(
      storage.copyObject({
        sourceBucket: quarantineBucket,
        sourceKey,
        destinationBucket: destination.bucket,
        destinationKey: destination.key,
      }),
    ).rejects.toThrow();
  });

  test('deleteObject removes the object and is idempotent for missing keys', async () => {
    const payload = encode('delete me');
    const location = track(quarantineBucket, testKey('integration/delete'));

    await storage.putObject({
      location,
      body: payload,
      contentType: 'application/octet-stream',
    });
    await storage.deleteObject(location);

    await expect(storage.headObject(location)).rejects.toThrow();
    await expect(storage.deleteObject(location)).resolves.toBeUndefined();
  });

  test('createMultipartUpload, uploadPart, and completeMultipartUpload assemble one object', async () => {
    const key = testKey('integration/multipart');
    const location = track(cleanBucket, key);
    // S3 rejects complete when any non-final part is under 5 MiB.
    const partOne = new Uint8Array(5 * 1024 * 1024).fill(0x61);
    const partTwo = encode('part-two-payload');

    const handle = await storage.createMultipartUpload({
      bucket: location.bucket,
      key: location.key,
      contentType: 'application/octet-stream',
    });
    expect(handle.uploadId).not.toBe('');

    const uploadedOne = await storage.uploadPart({
      bucket: location.bucket,
      key: location.key,
      uploadId: handle.uploadId,
      partNumber: 1,
      body: partOne,
    });
    expect(uploadedOne.partNumber).toBe(1);
    expect(uploadedOne.etag).not.toBe('');

    const uploadedTwo = await storage.uploadPart({
      bucket: location.bucket,
      key: location.key,
      uploadId: handle.uploadId,
      partNumber: 2,
      body: partTwo,
    });
    expect(uploadedTwo.partNumber).toBe(2);

    const completed = await storage.completeMultipartUpload({
      bucket: location.bucket,
      key: location.key,
      uploadId: handle.uploadId,
      parts: [
        { partNumber: uploadedOne.partNumber, etag: uploadedOne.etag },
        { partNumber: uploadedTwo.partNumber, etag: uploadedTwo.etag },
      ],
    });
    expect(completed.etag).toMatch(/-2$/);

    const got = await storage.getObject(location);
    const bytes = await readBody(got.body);
    expect(bytes.byteLength).toBe(partOne.byteLength + partTwo.byteLength);
    expect(bytes.slice(0, 4)).toEqual(new Uint8Array([0x61, 0x61, 0x61, 0x61]));
    expect(bytes.slice(partOne.byteLength)).toEqual(partTwo);
    expect(got.etag).toBe(completed.etag);
  });

  test('abortMultipartUpload discards in-progress parts', async () => {
    const key = testKey('integration/multipart-abort');
    const location = track(quarantineBucket, key);

    const handle = await storage.createMultipartUpload({
      bucket: location.bucket,
      key: location.key,
      contentType: 'application/octet-stream',
    });
    await storage.uploadPart({
      bucket: location.bucket,
      key: location.key,
      uploadId: handle.uploadId,
      partNumber: 1,
      body: encode('doomed'),
    });

    await storage.abortMultipartUpload({
      bucket: location.bucket,
      key: location.key,
      uploadId: handle.uploadId,
    });

    await expect(storage.headObject(location)).rejects.toThrow();
    await expect(
      storage.completeMultipartUpload({
        bucket: location.bucket,
        key: location.key,
        uploadId: handle.uploadId,
        parts: [{ partNumber: 1, etag: '00' }],
      }),
    ).rejects.toThrow();
  });

  test('presignPut produces a URL that accepts a direct upload', async () => {
    const payload = encode('presigned payload');
    const location = track(forensicBucket, testKey('integration/presign'));

    const presign = await storage.presignPut({
      location,
      expiresIn: 900,
      contentType: 'application/octet-stream',
    });
    expect(presign.method).toBe('PUT');
    expect(presign.headers['content-type']).toBe('application/octet-stream');
    expect(presign.url).toContain('X-Amz-Signature');
    expect(presign.url).toContain(location.key);

    const response = await fetch(presign.url, {
      method: 'PUT',
      headers: presign.headers,
      body: payload,
    });
    expect(response.status).toBe(200);

    const head = await storage.headObject(location);
    expect(head.contentLength).toBe(payload.byteLength);
    expect(head.contentType).toBe('application/octet-stream');
  });

  test('presignPut without contentType produces empty headers and still uploads', async () => {
    const payload = encode('presigned no content-type');
    const location = track(forensicBucket, testKey('integration/presign-bare'));

    const presign = await storage.presignPut({
      location,
      expiresIn: 900,
    });
    expect(presign.headers).toEqual({});

    const response = await fetch(presign.url, {
      method: 'PUT',
      body: payload,
    });
    expect(response.status).toBe(200);

    const head = await storage.headObject(location);
    expect(head.contentLength).toBe(payload.byteLength);
  });

  test('presignPut enforces a declared content length', async () => {
    const payload = encode('exact-length');
    const location = track(forensicBucket, testKey('integration/presign-length'));

    const presign = await storage.presignPut({
      location,
      expiresIn: 900,
      contentType: 'application/octet-stream',
      contentLength: payload.byteLength,
    });

    const mismatched = await fetch(presign.url, {
      method: 'PUT',
      headers: presign.headers,
      body: encode('too-long-payload'),
    });
    expect(mismatched.ok).toBe(false);

    const matched = await fetch(presign.url, {
      method: 'PUT',
      headers: presign.headers,
      body: payload,
    });
    expect(matched.status).toBe(200);
    expect((await storage.headObject(location)).contentLength).toBe(payload.byteLength);
  });
});
