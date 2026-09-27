import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vite-plus/test';
import { createControllableStorage } from './controllable-storage.ts';

const hasDatabase = Boolean(process.env.DB_URL);

async function loadModules() {
  const db = await import('@open-fms/database');
  const lifecycle = await import('../src/index.ts');
  return { db, lifecycle };
}

type DbModule = Awaited<ReturnType<typeof loadModules>>['db'];

async function seedTenant(db: DbModule): Promise<{ callerId: string; backendId: string }> {
  const backendRows = await db.db
    .insert(db.storageBackends)
    .values({
      name: `test-backend-${Date.now()}`,
      kind: 'minio',
      endpoint: 'http://127.0.0.1:9000',
      quarantineBucket: 'quarantine',
      cleanBucket: 'clean',
      credentialRef: 'env:test',
      isDefault: false,
    })
    .returning({ id: db.storageBackends.id });
  const backend = backendRows[0];
  if (!backend) {
    throw new Error('SEED_BACKEND_FAILED');
  }

  const callerRows = await db.db
    .insert(db.callers)
    .values({
      name: `test-caller-${Date.now()}`,
      kind: 'app',
      status: 'active',
      signupSource: 'admin',
      quotaBytes: 10_000_000,
      createdBy: crypto.randomUUID(),
    })
    .returning({ id: db.callers.id });
  const caller = callerRows[0];
  if (!caller) {
    throw new Error('SEED_CALLER_FAILED');
  }

  return { callerId: caller.id, backendId: backend.id };
}

describe.skipIf(!hasDatabase)('lifecycle integration', () => {
  test('happy path promotes clean files and converts quota', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `sealed/${crypto.randomUUID()}`,
      originalFilename: 'file.bin',
      declaredContentType: 'application/octet-stream',
      declaredSizeBytes: 1024,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await lifecycle.markUploading({ fileId: created.fileId, expectedRowVersion: 1 });
    await lifecycle.completeAndEnqueueScan({
      fileId: created.fileId,
      expectedRowVersion: 2,
      checksumSha256: Buffer.alloc(32, 1),
      sizeBytes: 1024,
      etag: 'etag-1',
      sealedEtag: 'etag-1',
      detectedContentType: 'application/octet-stream',
    });

    const usage = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId))
      .limit(1);
    expect(usage[0]?.bytesUsed).toBe(1024);
    expect(usage[0]?.bytesReserved).toBe(0);
    expect(usage[0]?.fileCount).toBe(1);

    const storage = createControllableStorage();
    storage.seedObject(
      { bucket: 'quarantine', key: created.objectKey },
      { etag: 'etag-1', contentLength: 1024 },
    );

    const quarantined = await db.loadFileById(created.fileId);
    if (!quarantined) {
      throw new Error('FILE_MISSING');
    }
    await lifecycle.markScanning({
      fileId: created.fileId,
      expectedRowVersion: quarantined.rowVersion,
    });
    const file = await db.loadFileById(created.fileId);
    if (!file) {
      throw new Error('FILE_MISSING');
    }

    await lifecycle.applyScanVerdict({
      fileId: created.fileId,
      expectedRowVersion: file.rowVersion,
      verdict: 'clean',
      storage,
      cleanBucket: 'clean',
      quarantineBucket: 'quarantine',
      objectKey: created.objectKey,
      sealedEtag: 'etag-1',
    });

    const promoted = await db.loadFileById(created.fileId);
    expect(promoted?.status).toBe('clean');
    expect(storage.copies).toHaveLength(1);
    expect(() => {
      lifecycle.assertDownloadable('clean');
    }).not.toThrow();
  });

  test('stale etag blocks clean promotion', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `sealed/${crypto.randomUUID()}`,
      originalFilename: 'stale.bin',
      declaredContentType: null,
      declaredSizeBytes: 10,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await lifecycle.markUploading({ fileId: created.fileId, expectedRowVersion: 1 });
    await lifecycle.completeAndEnqueueScan({
      fileId: created.fileId,
      expectedRowVersion: 2,
      checksumSha256: Buffer.alloc(32, 2),
      sizeBytes: 10,
      etag: 'sealed-etag',
      sealedEtag: 'sealed-etag',
      detectedContentType: null,
    });

    const quarantined = await db.loadFileById(created.fileId);
    if (!quarantined) {
      throw new Error('FILE_MISSING');
    }
    await lifecycle.markScanning({
      fileId: created.fileId,
      expectedRowVersion: quarantined.rowVersion,
    });
    const file = await db.loadFileById(created.fileId);
    if (!file) {
      throw new Error('FILE_MISSING');
    }

    const storage = createControllableStorage();
    storage.seedObject(
      { bucket: 'quarantine', key: created.objectKey },
      { etag: 'stale-etag', contentLength: 10 },
    );

    await expect(
      lifecycle.applyScanVerdict({
        fileId: created.fileId,
        expectedRowVersion: file.rowVersion,
        verdict: 'clean',
        storage,
        cleanBucket: 'clean',
        quarantineBucket: 'quarantine',
        objectKey: created.objectKey,
        sealedEtag: 'sealed-etag',
      }),
    ).rejects.toThrow('STORAGE_PROMOTE_MISMATCH');

    const after = await db.loadFileById(created.fileId);
    expect(after?.status).toBe('scanning');
  });

  test('duplicate completion with stale row version conflicts', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `sealed/${crypto.randomUUID()}`,
      originalFilename: 'dup.bin',
      declaredContentType: null,
      declaredSizeBytes: 8,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await lifecycle.markUploading({ fileId: created.fileId, expectedRowVersion: 1 });
    await lifecycle.completeAndEnqueueScan({
      fileId: created.fileId,
      expectedRowVersion: 2,
      checksumSha256: Buffer.alloc(32, 3),
      sizeBytes: 8,
      etag: 'e',
      sealedEtag: 'e',
      detectedContentType: null,
    });

    await expect(
      lifecycle.completeAndEnqueueScan({
        fileId: created.fileId,
        expectedRowVersion: 2,
        checksumSha256: Buffer.alloc(32, 3),
        sizeBytes: 8,
        etag: 'e',
        sealedEtag: 'e',
        detectedContentType: null,
      }),
    ).rejects.toThrow('FILE_ROW_VERSION_CONFLICT');
  });

  test('abort releases reserved quota', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `sealed/${crypto.randomUUID()}`,
      originalFilename: 'abort.bin',
      declaredContentType: null,
      declaredSizeBytes: 4096,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const reserved = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId))
      .limit(1);
    expect(reserved[0]?.bytesReserved).toBe(4096);

    await lifecycle.abortFile({
      fileId: created.fileId,
      expectedStatus: 'initiated',
      expectedRowVersion: 1,
      reason: 'test_abort',
      reservedBytes: 4096,
    });

    const released = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId))
      .limit(1);
    expect(released[0]?.bytesReserved).toBe(0);
    const file = await db.loadFileById(created.fileId);
    expect(file?.status).toBe('failed');
  });

  test('download denied before clean', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `sealed/${crypto.randomUUID()}`,
      originalFilename: 'blocked.bin',
      declaredContentType: null,
      declaredSizeBytes: 1,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });

    const file = await db.loadFileById(created.fileId);
    if (!file) {
      throw new Error('FILE_MISSING');
    }

    expect(() => {
      if (file.status !== 'clean') {
        lifecycle.assertDownloadable('infected');
      }
    }).toThrow('FILE_NOT_DOWNLOADABLE');
  });

  test('storage copy failure leaves file non-clean', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `sealed/${crypto.randomUUID()}`,
      originalFilename: 'copyfail.bin',
      declaredContentType: null,
      declaredSizeBytes: 4,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await lifecycle.markUploading({ fileId: created.fileId, expectedRowVersion: 1 });
    await lifecycle.completeAndEnqueueScan({
      fileId: created.fileId,
      expectedRowVersion: 2,
      checksumSha256: Buffer.alloc(32, 4),
      sizeBytes: 4,
      etag: 'e',
      sealedEtag: 'e',
      detectedContentType: null,
    });

    const quarantined = await db.loadFileById(created.fileId);
    if (!quarantined) {
      throw new Error('FILE_MISSING');
    }
    await lifecycle.markScanning({
      fileId: created.fileId,
      expectedRowVersion: quarantined.rowVersion,
    });
    const file = await db.loadFileById(created.fileId);
    if (!file) {
      throw new Error('FILE_MISSING');
    }

    const storage = createControllableStorage();
    storage.failNextCopy = new Error('copy_failed');
    await expect(
      lifecycle.applyScanVerdict({
        fileId: created.fileId,
        expectedRowVersion: file.rowVersion,
        verdict: 'clean',
        storage,
        cleanBucket: 'clean',
        quarantineBucket: 'quarantine',
        objectKey: created.objectKey,
        sealedEtag: 'e',
      }),
    ).rejects.toThrow('copy_failed');

    const after = await db.loadFileById(created.fileId);
    expect(after?.status).toBe('scanning');
  });

  test('purge transitions to deleted', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `sealed/${crypto.randomUUID()}`,
      originalFilename: 'purge.bin',
      declaredContentType: null,
      declaredSizeBytes: 2,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await lifecycle.markUploading({ fileId: created.fileId, expectedRowVersion: 1 });
    await lifecycle.completeAndEnqueueScan({
      fileId: created.fileId,
      expectedRowVersion: 2,
      checksumSha256: Buffer.alloc(32, 5),
      sizeBytes: 2,
      etag: 'e',
      sealedEtag: 'e',
      detectedContentType: null,
    });

    const quarantined = await db.loadFileById(created.fileId);
    if (!quarantined) {
      throw new Error('FILE_MISSING');
    }
    await lifecycle.markScanning({
      fileId: created.fileId,
      expectedRowVersion: quarantined.rowVersion,
    });
    const scanning = await db.loadFileById(created.fileId);
    if (!scanning) {
      throw new Error('FILE_MISSING');
    }

    const storage = createControllableStorage();
    storage.seedObject(
      { bucket: 'quarantine', key: created.objectKey },
      { etag: 'e', contentLength: 2 },
    );
    await lifecycle.applyScanVerdict({
      fileId: created.fileId,
      expectedRowVersion: scanning.rowVersion,
      verdict: 'clean',
      storage,
      cleanBucket: 'clean',
      quarantineBucket: 'quarantine',
      objectKey: created.objectKey,
      sealedEtag: 'e',
    });

    const file = await db.loadFileById(created.fileId);
    if (!file) {
      throw new Error('FILE_MISSING');
    }

    await lifecycle.purgeFile({
      fileId: created.fileId,
      expectedStatus: 'clean',
      expectedRowVersion: file.rowVersion,
    });

    const purged = await db.loadFileById(created.fileId);
    expect(purged?.status).toBe('deleted');
  });
});
