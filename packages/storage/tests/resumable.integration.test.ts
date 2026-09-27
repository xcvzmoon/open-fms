import type { ObjectLocation, S3StorageAdapter, StorageBackendConfig } from '../src/index.ts';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vite-plus/test';
import { createStorageAdapter } from '../src/index.ts';

const endpoint = process.env.STORAGE_TEST_ENDPOINT;

const accessKeyId = process.env.STORAGE_TEST_ACCESS_KEY_ID ?? 'minioadmin';
const secretAccessKey = process.env.STORAGE_TEST_SECRET_ACCESS_KEY ?? 'minioadmin';
const region = process.env.STORAGE_TEST_REGION ?? 'us-east-1';
const forcePathStyle = process.env.STORAGE_TEST_FORCE_PATH_STYLE !== 'false';
const quarantineBucket = process.env.STORAGE_TEST_QUARANTINE_BUCKET ?? 'fms-quarantine';

const config: StorageBackendConfig = {
  id: 'resumable-test',
  name: 'resumable-test',
  kind: 'minio',
  endpoint: endpoint ?? 'http://127.0.0.1:9000',
  region,
  quarantineBucket,
  cleanBucket: process.env.STORAGE_TEST_CLEAN_BUCKET ?? 'fms-clean',
  forensicBucket: process.env.STORAGE_TEST_FORENSIC_BUCKET ?? 'fms-forensic',
  credentialRef: 'env:storage-test',
  forcePathStyle,
};

const PART_MIN = 5 * 1024 * 1024;

function testKey(prefix: string): string {
  return `${prefix}/${crypto.randomUUID()}`;
}

function digest(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

function filled(size: number, byte: number): Uint8Array {
  return new Uint8Array(size).fill(byte);
}

async function readBody(stream: ReadableStream): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

type TrackedPart = {
  partNumber: number;
  etag: string;
  sizeBytes: number;
  sha256: string;
};

/**
 * Mirrors the API `proxy_parts` path against real S3 multipart:
 * one upload id per file, out-of-order and retried parts, then a single complete.
 */
describe.skipIf(!endpoint)('resumable multipart uploads against a real backend', () => {
  let storage: S3StorageAdapter;
  const cleanupKeys: ObjectLocation[] = [];

  function track(bucket: string, key: string): ObjectLocation {
    const location = { bucket, key };
    cleanupKeys.push(location);
    return location;
  }

  beforeAll(() => {
    storage = createStorageAdapter({
      config,
      credentials: { accessKeyId, secretAccessKey },
    });
  });

  afterAll(async () => {
    await Promise.all(
      cleanupKeys.map(async (location) => {
        try {
          await storage.deleteObject(location);
        } catch {
          // best-effort cleanup
        }
      }),
    );
    storage.destroy();
  });

  async function uploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
  ): Promise<TrackedPart> {
    const result = await storage.uploadPart({
      bucket: quarantineBucket,
      key,
      uploadId,
      partNumber,
      body,
    });
    return {
      partNumber: result.partNumber,
      etag: result.etag,
      sizeBytes: body.byteLength,
      sha256: digest(body),
    };
  }

  test('accepts out-of-order parts, retries, and seals one object', async () => {
    const location = track(quarantineBucket, testKey('resumable/out-of-order'));
    const partOne = filled(PART_MIN, 0x11);
    const partTwo = filled(PART_MIN, 0x22);
    const partThree = new TextEncoder().encode('final-tail');
    const expectedDigest = digest(
      (() => {
        const joined = new Uint8Array(
          partOne.byteLength + partTwo.byteLength + partThree.byteLength,
        );
        joined.set(partOne, 0);
        joined.set(partTwo, partOne.byteLength);
        joined.set(partThree, partOne.byteLength + partTwo.byteLength);
        return joined;
      })(),
    );

    const handle = await storage.createMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
      contentType: 'application/octet-stream',
    });

    // Client resumes: part 3 first, then 1, then 2.
    const tracked = new Map<number, TrackedPart>();
    tracked.set(3, await uploadPart(location.key, handle.uploadId, 3, partThree));
    tracked.set(1, await uploadPart(location.key, handle.uploadId, 1, partOne));
    tracked.set(2, await uploadPart(location.key, handle.uploadId, 2, partTwo));
    // Retry of an already-uploaded part replaces it.
    tracked.set(2, await uploadPart(location.key, handle.uploadId, 2, partTwo));

    const ordered: TrackedPart[] = [];
    for (const partNumber of [1, 2, 3]) {
      const part = tracked.get(partNumber);
      if (!part) {
        throw new Error('RESUMABLE_PART_MISSING');
      }
      ordered.push(part);
    }

    const completed = await storage.completeMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
      uploadId: handle.uploadId,
      parts: ordered.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    });

    const got = await storage.getObject({ bucket: quarantineBucket, key: location.key });
    const bytes = await readBody(got.body);
    expect(bytes.byteLength).toBe(partOne.byteLength + partTwo.byteLength + partThree.byteLength);
    expect(digest(bytes)).toBe(expectedDigest);
    expect(got.etag).toBe(completed.etag);
    expect(completed.etag).toMatch(/-3$/);
  });

  test('allows a single small part when the file is tiny', async () => {
    const location = track(quarantineBucket, testKey('resumable/tiny'));
    const payload = new TextEncoder().encode('tiny');

    const handle = await storage.createMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
    });
    const part = await uploadPart(location.key, handle.uploadId, 1, payload);
    const completed = await storage.completeMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
      uploadId: handle.uploadId,
      parts: [{ partNumber: part.partNumber, etag: part.etag }],
    });

    const got = await storage.getObject({ bucket: quarantineBucket, key: location.key });
    const bytes = await readBody(got.body);
    expect(new TextDecoder().decode(bytes)).toBe('tiny');
    expect(completed.etag).not.toBe('');
  });

  test('rejects complete when a non-final part is under 5 MiB', async () => {
    const location = track(quarantineBucket, testKey('resumable/too-small'));
    const handle = await storage.createMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
    });

    const small = await uploadPart(location.key, handle.uploadId, 1, new Uint8Array(1024));
    const last = await uploadPart(
      location.key,
      handle.uploadId,
      2,
      new TextEncoder().encode('tail'),
    );

    await expect(
      storage.completeMultipartUpload({
        bucket: quarantineBucket,
        key: location.key,
        uploadId: handle.uploadId,
        parts: [
          { partNumber: small.partNumber, etag: small.etag },
          { partNumber: last.partNumber, etag: last.etag },
        ],
      }),
    ).rejects.toThrow();

    await storage.abortMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
      uploadId: handle.uploadId,
    });
    await expect(storage.headObject(location)).rejects.toThrow();
  });

  test('abort after partial upload leaves no object and cannot complete', async () => {
    const location = track(quarantineBucket, testKey('resumable/abort'));
    const handle = await storage.createMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
    });
    const part = await uploadPart(location.key, handle.uploadId, 1, filled(PART_MIN, 0x33));

    await storage.abortMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
      uploadId: handle.uploadId,
    });

    await expect(storage.headObject(location)).rejects.toThrow();
    await expect(
      storage.completeMultipartUpload({
        bucket: quarantineBucket,
        key: location.key,
        uploadId: handle.uploadId,
        parts: [{ partNumber: part.partNumber, etag: part.etag }],
      }),
    ).rejects.toThrow();
  });

  test('overwrites a part number during resume and keeps checksum of final bytes', async () => {
    const location = track(quarantineBucket, testKey('resumable/overwrite'));
    const handle = await storage.createMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
    });

    const stale = filled(PART_MIN, 0x44);
    const fresh = filled(PART_MIN, 0x55);
    const tail = new TextEncoder().encode('tail');
    const expectedDigest = digest(
      (() => {
        const joined = new Uint8Array(fresh.byteLength + tail.byteLength);
        joined.set(fresh, 0);
        joined.set(tail, fresh.byteLength);
        return joined;
      })(),
    );

    await uploadPart(location.key, handle.uploadId, 1, stale);
    const replaced = await uploadPart(location.key, handle.uploadId, 1, fresh);
    const last = await uploadPart(location.key, handle.uploadId, 2, tail);

    await storage.completeMultipartUpload({
      bucket: quarantineBucket,
      key: location.key,
      uploadId: handle.uploadId,
      parts: [
        { partNumber: replaced.partNumber, etag: replaced.etag },
        { partNumber: last.partNumber, etag: last.etag },
      ],
    });

    const got = await storage.getObject({ bucket: quarantineBucket, key: location.key });
    const bytes = await readBody(got.body);
    expect(bytes.byteLength).toBe(fresh.byteLength + tail.byteLength);
    expect(bytes[0]).toBe(0x55);
    expect(bytes[bytes.byteLength - 1]).toBe(tail[tail.byteLength - 1]);
    expect(digest(bytes)).toBe(expectedDigest);
  });
});
