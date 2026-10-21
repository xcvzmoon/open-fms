import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vite-plus/test';
import { createControllableStorage } from './controllable-storage.ts';

function fixtureDatabaseEnabled(): boolean {
  if (process.env.FMS_LIFECYCLE_INTEGRATION !== '1') return false;
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(process.env.DB_URL ?? '');
  } catch {
    throw new Error('LIFECYCLE_FIXTURE_DATABASE_REQUIRED');
  }
  if (
    !['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(databaseUrl.hostname) ||
    !['/audit_test', '/open-fms'].includes(databaseUrl.pathname) ||
    databaseUrl.search !== '' ||
    databaseUrl.hash !== ''
  ) {
    throw new Error('LIFECYCLE_FIXTURE_DATABASE_REQUIRED');
  }
  return true;
}

const hasDatabase = fixtureDatabaseEnabled();
const ownedBackendIds: string[] = [];
const ownedCallerIds: string[] = [];
const ownedUserIds: string[] = [];

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

  ownedBackendIds.push(backend.id);

  const ownerUserId = crypto.randomUUID();
  await db.db.insert(db.authUsers).values({
    id: ownerUserId,
    name: 'Lifecycle test owner',
    email: `lifecycle-${ownerUserId}@example.test`,
    emailVerified: true,
  });
  ownedUserIds.push(ownerUserId);
  const callerRows = await db.db
    .insert(db.callers)
    .values({
      name: `test-caller-${Date.now()}`,
      kind: 'app',
      ownerUserId,
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

  ownedCallerIds.push(caller.id);
  return { callerId: caller.id, backendId: backend.id };
}

async function ownScanJob(
  db: DbModule,
  fileId: string,
): Promise<{ scanJobId: string; leaseToken: string }> {
  const leaseToken = crypto.randomUUID();
  const [job] = await db.db
    .update(db.scanJobs)
    .set({
      status: 'running',
      leaseToken,
      leaseExpiresAt: new Date(Date.now() + 60_000),
    })
    .where(eq(db.scanJobs.fileId, fileId))
    .returning({ scanJobId: db.scanJobs.id });
  if (!job) throw new Error('SEED_SCAN_JOB_FAILED');
  return { scanJobId: job.scanJobId, leaseToken };
}

async function scanningFixture() {
  const { db, lifecycle } = await loadModules();
  const { callerId, backendId } = await seedTenant(db);
  await db.db.update(db.callers).set({ retentionDays: 2 }).where(eq(db.callers.id, callerId));
  const created = await lifecycle.createFileWithUploadSession({
    callerId,
    storageBackendId: backendId,
    objectKey: `audit/${crypto.randomUUID()}`,
    originalFilename: 'audit.bin',
    declaredContentType: null,
    declaredSizeBytes: 32,
    mode: 'proxy_single',
    expiresAt: new Date(Date.now() + 60_000),
  });
  await lifecycle.markUploading({ fileId: created.fileId, expectedRowVersion: 1 });
  await lifecycle.completeAndEnqueueScan({
    fileId: created.fileId,
    expectedRowVersion: 2,
    checksumSha256: Buffer.alloc(32, 7),
    sizeBytes: 32,
    etag: 'audit-etag',
    sealedEtag: 'audit-etag',
    detectedContentType: null,
  });
  await lifecycle.markScanning({ fileId: created.fileId, expectedRowVersion: 3 });
  const lease = await ownScanJob(db, created.fileId);
  const storage = createControllableStorage();
  storage.seedObject(
    { bucket: 'quarantine', key: created.objectKey },
    { etag: 'audit-etag', contentLength: 32 },
  );
  const verdict = {
    fileId: created.fileId,
    expectedRowVersion: 4,
    ...lease,
    verdict: 'clean' as const,
    storage,
    cleanBucket: 'clean',
    quarantineBucket: 'quarantine',
    objectKey: created.objectKey,
    sealedEtag: 'audit-etag',
  };
  return { db, lifecycle, callerId, created, storage, verdict };
}

describe.skipIf(!hasDatabase)('lifecycle integration', () => {
  afterAll(async () => {
    if (!ownedBackendIds.length && !ownedCallerIds.length && !ownedUserIds.length) return;
    const { db } = await loadModules();
    await db.db.transaction(async (tx) => {
      if (ownedCallerIds.length) {
        const ownedFiles = await tx
          .select({ id: db.files.id })
          .from(db.files)
          .where(inArray(db.files.callerId, ownedCallerIds));
        const ownedFileIds = ownedFiles.map(({ id }) => id);
        if (ownedFileIds.length) {
          await tx.delete(db.scanJobs).where(inArray(db.scanJobs.fileId, ownedFileIds));
          await tx.delete(db.uploadSessions).where(inArray(db.uploadSessions.fileId, ownedFileIds));
          await tx.delete(db.files).where(inArray(db.files.id, ownedFileIds));
        }
        await tx.delete(db.callerUsage).where(inArray(db.callerUsage.callerId, ownedCallerIds));
        await tx.delete(db.callers).where(inArray(db.callers.id, ownedCallerIds));
      }
      if (ownedBackendIds.length) {
        await tx.delete(db.storageBackends).where(inArray(db.storageBackends.id, ownedBackendIds));
      }
      if (ownedUserIds.length) {
        await tx.delete(db.authUsers).where(inArray(db.authUsers.id, ownedUserIds));
      }
    });
  });
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
      ...(await ownScanJob(db, created.fileId)),
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
    const metadata = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    expect(metadata[0]?.scannedAt).toBeInstanceOf(Date);
    expect(metadata[0]?.promotedAt).toBeInstanceOf(Date);
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
        ...(await ownScanJob(db, created.fileId)),
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

  test('quota reservations serialize concurrent admissions', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const results = await Promise.allSettled(
      [1, 2].map((index) =>
        lifecycle.createFileWithUploadSession({
          callerId,
          storageBackendId: backendId,
          objectKey: `concurrent/${crypto.randomUUID()}/${index}`,
          originalFilename: 'quota.bin',
          declaredContentType: null,
          declaredSizeBytes: 6_000_000,
          mode: 'proxy_single',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'QUOTA_EXCEEDED' },
    });
    const [usage] = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId));
    expect(usage).toMatchObject({ bytesReserved: 6_000_000, bytesUsed: 0, fileCount: 0 });
    const admitted = await db.db.select().from(db.files).where(eq(db.files.callerId, callerId));
    expect(admitted).toHaveLength(1);
  });

  test('completion rejects actual bytes beyond the reservation', async () => {
    const { db, lifecycle } = await loadModules();
    const { callerId, backendId } = await seedTenant(db);
    const created = await lifecycle.createFileWithUploadSession({
      callerId,
      storageBackendId: backendId,
      objectKey: `quota/${crypto.randomUUID()}`,
      originalFilename: 'quota.bin',
      declaredContentType: null,
      declaredSizeBytes: 8,
      mode: 'proxy_single',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await lifecycle.markUploading({ fileId: created.fileId, expectedRowVersion: 1 });
    await expect(
      lifecycle.completeAndEnqueueScan({
        fileId: created.fileId,
        expectedRowVersion: 2,
        checksumSha256: Buffer.alloc(32, 1),
        sizeBytes: 16,
        etag: 'test',
        sealedEtag: 'test',
        detectedContentType: null,
      }),
    ).rejects.toThrow('UPLOAD_SIZE_MISMATCH');
    const [usage] = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId));
    expect(usage).toMatchObject({ bytesReserved: 8, bytesUsed: 0, fileCount: 0 });
    const [file] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    expect(file).toMatchObject({ status: 'uploading', rowVersion: 2, uploadedAt: null });
    const jobs = await db.db
      .select()
      .from(db.scanJobs)
      .where(eq(db.scanJobs.fileId, created.fileId));
    expect(jobs).toHaveLength(0);
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
    });

    const released = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId))
      .limit(1);
    expect(released[0]).toMatchObject({ bytesReserved: 0, bytesUsed: 0, fileCount: 0 });
    await expect(
      lifecycle.abortFile({
        fileId: created.fileId,
        expectedStatus: 'initiated',
        expectedRowVersion: 1,
        reason: 'duplicate_abort',
      }),
    ).rejects.toThrow('FILE_ROW_VERSION_CONFLICT');
    const [afterDuplicate] = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId));
    expect(afterDuplicate).toEqual(released[0]);
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
        ...(await ownScanJob(db, created.fileId)),
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
      ...(await ownScanJob(db, created.fileId)),
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
      storage,
      cleanBucket: 'clean',
      quarantineBucket: 'quarantine',
      forensicBucket: null,
    });

    const purged = await db.loadFileById(created.fileId);
    expect(purged?.status).toBe('deleted');
  });
  test('completion and verdict persist lifecycle timestamps and retention', async () => {
    const { db, lifecycle, created, verdict } = await scanningFixture();
    const [uploaded] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    const [session] = await db.db
      .select()
      .from(db.uploadSessions)
      .where(eq(db.uploadSessions.fileId, created.fileId));
    expect(uploaded?.uploadedAt).toBeInstanceOf(Date);
    expect(session?.completedAt).toEqual(uploaded?.uploadedAt);
    expect(uploaded?.retainUntil?.getTime()).toBe(
      (uploaded?.uploadedAt?.getTime() ?? 0) + 2 * 86_400_000,
    );
    expect(uploaded?.purgeAfter).toEqual(uploaded?.retainUntil);
    expect(uploaded?.scannedAt).toBeNull();
    expect(uploaded?.promotedAt).toBeNull();
    await lifecycle.applyScanVerdict(verdict);
    const [clean] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    expect(clean?.scannedAt).toBeInstanceOf(Date);
    expect(clean?.promotedAt).toEqual(clean?.scannedAt);
    expect(clean?.uploadedAt).toEqual(uploaded?.uploadedAt);
  });

  test('retention and legal hold prevent physical deletion and preserve quota', async () => {
    const { db, lifecycle, created, storage, verdict, callerId } = await scanningFixture();
    await lifecycle.applyScanVerdict(verdict);
    const purge = {
      fileId: created.fileId,
      expectedStatus: 'clean' as const,
      expectedRowVersion: 5,
      storage,
      cleanBucket: 'clean',
      quarantineBucket: 'quarantine',
      forensicBucket: null,
    };
    await expect(lifecycle.purgeFile(purge)).rejects.toThrow('FILE_TRANSITION_INVALID');
    await db.db
      .update(db.files)
      .set({ retainUntil: new Date(0), legalHold: true })
      .where(eq(db.files.id, created.fileId));
    await expect(lifecycle.purgeFile(purge)).rejects.toThrow('FILE_TRANSITION_INVALID');
    expect(storage.deletes).toHaveLength(0);
    const [usage] = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId));
    expect(usage).toMatchObject({ bytesUsed: 32, bytesReserved: 0, fileCount: 1 });
    const [file] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    expect(file).toMatchObject({ status: 'clean', deletedAt: null, purgedAt: null });
  });

  test('physical deletion failure retains quota and retry releases it exactly once', async () => {
    const { db, lifecycle, created, storage, verdict, callerId } = await scanningFixture();
    await lifecycle.applyScanVerdict(verdict);
    await db.db
      .update(db.files)
      .set({ retainUntil: new Date(0) })
      .where(eq(db.files.id, created.fileId));
    storage.seedObject(
      { bucket: 'forensic', key: created.objectKey },
      { etag: 'audit-etag', contentLength: 32 },
    );
    const purge = {
      fileId: created.fileId,
      expectedStatus: 'clean' as const,
      expectedRowVersion: 5,
      storage,
      cleanBucket: 'clean',
      quarantineBucket: 'quarantine',
      forensicBucket: 'forensic',
    };
    storage.failNextDelete = new Error('delete_failed');
    await expect(lifecycle.purgeFile(purge)).rejects.toThrow('delete_failed');
    const [failed] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    expect(failed?.status).toBe('deleted');
    expect(failed?.deletedAt).toBeInstanceOf(Date);
    expect(failed?.purgedAt).toBeNull();
    const [charged] = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId));
    expect(charged).toMatchObject({ bytesUsed: 32, fileCount: 1 });
    const retry = {
      ...purge,
      expectedStatus: 'deleted' as const,
      expectedRowVersion: failed?.rowVersion ?? 0,
    };
    await lifecycle.purgeFile(retry);
    await lifecycle.purgeFile(retry);
    const [usage] = await db.db
      .select()
      .from(db.callerUsage)
      .where(eq(db.callerUsage.callerId, callerId));
    expect(usage).toMatchObject({ bytesUsed: 0, bytesReserved: 0, fileCount: 0 });
    const [purged] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    expect(purged?.purgedAt).toBeInstanceOf(Date);
    expect(purged?.deletedAt).toEqual(failed?.deletedAt);
    expect(storage.objects.size).toBe(0);
    expect(storage.deletes.map(({ bucket }) => bucket)).toEqual([
      'clean',
      'clean',
      'quarantine',
      'forensic',
    ]);
  });

  test.each(['replaced', 'expired', 'cancelled'] as const)(
    'a %s scan lease cannot promote a file',
    async (loss) => {
      const { db, lifecycle, created, storage, verdict } = await scanningFixture();
      await db.db
        .update(db.scanJobs)
        .set(
          loss === 'replaced'
            ? { leaseToken: crypto.randomUUID() }
            : loss === 'expired'
              ? { leaseExpiresAt: new Date(0) }
              : { status: 'cancelled' },
        )
        .where(eq(db.scanJobs.id, verdict.scanJobId));
      await expect(lifecycle.applyScanVerdict(verdict)).rejects.toThrow('SCAN_LEASE_LOST');
      expect(storage.copies).toHaveLength(0);
      const [file] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
      expect(file).toMatchObject({
        status: 'scanning',
        rowVersion: 4,
        scannedAt: null,
        promotedAt: null,
      });
    },
  );
  test('lease expiry during object copy fences the final clean transition', async () => {
    const { db, lifecycle, created, storage, verdict } = await scanningFixture();
    const expiresAt = new Date(Date.now() + 1000);
    await db.db
      .update(db.scanJobs)
      .set({ leaseExpiresAt: expiresAt })
      .where(eq(db.scanJobs.id, verdict.scanJobId));
    const delayedStorage = {
      ...storage,
      async copyObject(input: Parameters<typeof storage.copyObject>[0]): Promise<{ etag: string }> {
        const copied = await storage.copyObject(input);
        await new Promise<void>((resolve) =>
          setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now()) + 25),
        );
        return copied;
      },
    };
    await expect(
      lifecycle.applyScanVerdict({ ...verdict, storage: delayedStorage }),
    ).rejects.toThrow('SCAN_LEASE_LOST');
    expect(storage.copies).toHaveLength(1);
    const [file] = await db.db.select().from(db.files).where(eq(db.files.id, created.fileId));
    expect(file).toMatchObject({
      status: 'scanning',
      rowVersion: 4,
      scannedAt: null,
      promotedAt: null,
    });
  });
});
