import {
  callerUsage,
  callers,
  db,
  files,
  scanJobs,
  storageBackends,
  uploadSessions,
} from '@open-fms/database';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { canTransition, isDownloadableStatus, type FileStatus } from './status.ts';
import { LifecycleError, type LifecycleStorage } from './types.ts';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type UploadMode = 'proxy_single' | 'proxy_parts';
export type CreateFileInput = {
  callerId: string;
  storageBackendId: string;
  objectKey: string;
  originalFilename: string;
  declaredContentType: string | null;
  declaredSizeBytes: number | null;
  mode: UploadMode;
  ownerRef?: string | null;
  idempotencyKey?: string | null;
  expiresAt: Date;
};
export type CreatedFile = {
  fileId: string;
  uploadSessionId: string;
  objectKey: string;
  status: FileStatus;
};
export type GuardedTransitionInput = {
  fileId: string;
  expectedStatus: FileStatus;
  expectedRowVersion: number;
  toStatus: FileStatus;
  patch?: {
    scannedAt?: Date;
    promotedAt?: Date;
    deletedAt?: Date;
    scanPolicyVersion?: string | null;
    detectedContentType?: string | null;
    etag?: string;
  };
};

async function transitionFile(input: GuardedTransitionInput, tx: Transaction): Promise<void> {
  if (!canTransition(input.expectedStatus, input.toStatus))
    throw new LifecycleError('FILE_TRANSITION_INVALID');
  const rows = await tx
    .update(files)
    .set({
      ...input.patch,
      status: input.toStatus,
      rowVersion: sql`${files.rowVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(files.id, input.fileId),
        eq(files.status, input.expectedStatus),
        eq(files.rowVersion, input.expectedRowVersion),
      ),
    )
    .returning({ id: files.id });
  if (!rows[0]) throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
}

export async function createFileWithUploadSession(input: CreateFileInput): Promise<CreatedFile> {
  const reserveBytes = input.declaredSizeBytes;
  if (reserveBytes === null || !Number.isSafeInteger(reserveBytes) || reserveBytes < 0)
    throw new LifecycleError('UPLOAD_LIMIT_INVALID');
  return db.transaction(async (tx) => {
    const [caller] = await tx
      .select()
      .from(callers)
      .where(eq(callers.id, input.callerId))
      .for('update');
    if (caller?.status !== 'active' || caller.deletedAt)
      throw new LifecycleError('CALLER_NOT_ACTIVE');
    if (reserveBytes > caller.maxFileSizeBytes) throw new LifecycleError('UPLOAD_LIMIT_INVALID');
    if (
      caller.allowedContentTypes.length &&
      (!input.declaredContentType ||
        !caller.allowedContentTypes.includes(input.declaredContentType))
    )
      throw new LifecycleError('UPLOAD_TYPE_NOT_ALLOWED');
    const [backend] = await tx
      .select()
      .from(storageBackends)
      .where(eq(storageBackends.id, input.storageBackendId));
    if (backend?.status !== 'active') throw new LifecycleError('FILE_NOT_FOUND');
    if (input.idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(files)
        .where(
          and(eq(files.callerId, input.callerId), eq(files.idempotencyKey, input.idempotencyKey)),
        );
      if (existing) {
        const [session] = await tx
          .select()
          .from(uploadSessions)
          .where(eq(uploadSessions.fileId, existing.id));
        if (
          !session ||
          session.expiresAt <= new Date() ||
          existing.originalFilename !== input.originalFilename ||
          session.declaredSizeBytes !== reserveBytes ||
          session.mode !== input.mode ||
          existing.storageBackendId !== input.storageBackendId ||
          existing.declaredContentType !== input.declaredContentType
        )
          throw new LifecycleError('UPLOAD_SESSION_INVALID');
        return {
          fileId: existing.id,
          uploadSessionId: session.id,
          objectKey: existing.objectKey,
          status: existing.status,
        };
      }
    }
    await tx.insert(callerUsage).values({ callerId: input.callerId }).onConflictDoNothing();
    const [usage] = await tx
      .select()
      .from(callerUsage)
      .where(eq(callerUsage.callerId, input.callerId))
      .for('update');
    if (!usage) throw new LifecycleError('LIFECYCLE_FAILED');
    if (
      caller.quotaBytes !== null &&
      usage.bytesUsed + usage.bytesReserved + reserveBytes > caller.quotaBytes
    )
      throw new LifecycleError('QUOTA_EXCEEDED');
    const [file] = await tx
      .insert(files)
      .values({
        callerId: input.callerId,
        storageBackendId: input.storageBackendId,
        objectKey: input.objectKey,
        originalFilename: input.originalFilename,
        declaredContentType: input.declaredContentType,
        sizeBytes: reserveBytes,
        ownerRef: input.ownerRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: 'initiated',
      })
      .returning({ id: files.id });
    if (!file) throw new LifecycleError('LIFECYCLE_FAILED');
    const [session] = await tx
      .insert(uploadSessions)
      .values({
        fileId: file.id,
        callerId: input.callerId,
        mode: input.mode,
        status: 'initiated',
        declaredSizeBytes: reserveBytes,
        declaredContentType: input.declaredContentType,
        expiresAt: input.expiresAt,
      })
      .returning({ id: uploadSessions.id });
    if (!session) throw new LifecycleError('LIFECYCLE_FAILED');
    await tx
      .update(callerUsage)
      .set({
        bytesReserved: sql`${callerUsage.bytesReserved} + ${reserveBytes}`,
        rowVersion: sql`${callerUsage.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(callerUsage.callerId, input.callerId));
    return {
      fileId: file.id,
      uploadSessionId: session.id,
      objectKey: input.objectKey,
      status: 'initiated',
    };
  });
}

export async function markUploading(input: {
  fileId: string;
  expectedRowVersion: number;
}): Promise<void> {
  await db.transaction((tx) =>
    transitionFile({ ...input, expectedStatus: 'initiated', toStatus: 'uploading' }, tx),
  );
}

export async function completeAndEnqueueScan(input: {
  fileId: string;
  expectedRowVersion: number;
  checksumSha256: Buffer;
  sizeBytes: number;
  etag: string;
  sealedEtag: string;
  detectedContentType: string | null;
}): Promise<{ status: FileStatus; rowVersion: number }> {
  return db.transaction(async (tx) => {
    const [file] = await tx.select().from(files).where(eq(files.id, input.fileId)).for('update');
    if (file?.status !== 'uploading' || file.rowVersion !== input.expectedRowVersion)
      throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
    const [session] = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.fileId, file.id))
      .for('update');
    if (
      !session ||
      session.expiresAt <= new Date() ||
      !['initiated', 'uploading', 'completing'].includes(session.status)
    )
      throw new LifecycleError('UPLOAD_SESSION_INVALID');
    if (
      session.declaredSizeBytes === null ||
      !Number.isSafeInteger(input.sizeBytes) ||
      input.sizeBytes !== session.declaredSizeBytes
    )
      throw new LifecycleError('UPLOAD_SIZE_MISMATCH');
    if (input.checksumSha256.length !== 32 || !input.etag || input.etag !== input.sealedEtag)
      throw new LifecycleError('STORAGE_SEAL_MISMATCH');
    const [caller] = await tx
      .select()
      .from(callers)
      .where(eq(callers.id, file.callerId))
      .for('update');
    if (caller?.status !== 'active' || caller.deletedAt)
      throw new LifecycleError('CALLER_NOT_ACTIVE');
    if (input.sizeBytes > caller.maxFileSizeBytes) throw new LifecycleError('UPLOAD_LIMIT_INVALID');
    const uploadedAt = new Date();
    const retainUntil =
      caller.retentionDays === null
        ? null
        : new Date(uploadedAt.getTime() + caller.retentionDays * 86_400_000);
    const [updated] = await tx
      .update(files)
      .set({
        status: 'quarantined',
        checksumSha256: input.checksumSha256,
        sizeBytes: input.sizeBytes,
        etag: input.etag,
        sealedEtag: input.sealedEtag,
        detectedContentType: input.detectedContentType,
        uploadedAt,
        retainUntil,
        purgeAfter: retainUntil,
        rowVersion: sql`${files.rowVersion} + 1`,
        updatedAt: uploadedAt,
      })
      .where(and(eq(files.id, file.id), eq(files.rowVersion, input.expectedRowVersion)))
      .returning({ rowVersion: files.rowVersion });
    if (!updated) throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
    await tx.insert(scanJobs).values({ fileId: file.id, status: 'pending' });
    await tx
      .update(uploadSessions)
      .set({
        status: 'completed',
        receivedSizeBytes: input.sizeBytes,
        completedAt: uploadedAt,
        rowVersion: sql`${uploadSessions.rowVersion} + 1`,
        updatedAt: uploadedAt,
      })
      .where(eq(uploadSessions.id, session.id));
    const [usage] = await tx
      .update(callerUsage)
      .set({
        bytesReserved: sql`${callerUsage.bytesReserved} - ${session.declaredSizeBytes}`,
        bytesUsed: sql`${callerUsage.bytesUsed} + ${input.sizeBytes}`,
        fileCount: sql`${callerUsage.fileCount} + 1`,
        rowVersion: sql`${callerUsage.rowVersion} + 1`,
        updatedAt: uploadedAt,
      })
      .where(
        and(
          eq(callerUsage.callerId, file.callerId),
          sql`${callerUsage.bytesReserved} >= ${session.declaredSizeBytes}`,
        ),
      )
      .returning({ callerId: callerUsage.callerId });
    if (!usage) throw new LifecycleError('LIFECYCLE_FAILED');
    return { status: 'quarantined', rowVersion: updated.rowVersion };
  });
}

export async function markScanning(input: {
  fileId: string;
  expectedRowVersion: number;
}): Promise<void> {
  await db.transaction((tx) =>
    transitionFile({ ...input, expectedStatus: 'quarantined', toStatus: 'scanning' }, tx),
  );
}

export async function applyScanVerdict(input: {
  fileId: string;
  expectedRowVersion: number;
  scanJobId: string;
  leaseToken: string;
  verdict: 'clean' | 'infected' | 'rejected';
  storage: LifecycleStorage;
  cleanBucket: string;
  quarantineBucket: string;
  objectKey: string;
  sealedEtag: string;
  scanPolicyVersion?: string | null;
  detectedContentType?: string | null;
}): Promise<{ status: FileStatus }> {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(scanJobs)
      .where(
        and(
          eq(scanJobs.id, input.scanJobId),
          eq(scanJobs.fileId, input.fileId),
          eq(scanJobs.leaseToken, input.leaseToken),
          eq(scanJobs.status, 'running'),
          gt(scanJobs.leaseExpiresAt, new Date()),
        ),
      )
      .for('update');
    if (!job) throw new LifecycleError('SCAN_LEASE_LOST');
    const [file] = await tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, input.fileId),
          eq(files.status, 'scanning'),
          eq(files.rowVersion, input.expectedRowVersion),
        ),
      )
      .for('update');
    if (!file || file.objectKey !== input.objectKey || file.sealedEtag !== input.sealedEtag)
      throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
    let promotedEtag: string | undefined;
    if (input.verdict === 'clean') {
      const copied = await input.storage.copyObject({
        sourceBucket: input.quarantineBucket,
        sourceKey: file.objectKey,
        destinationBucket: input.cleanBucket,
        destinationKey: file.objectKey,
        sourceEtag: input.sealedEtag,
      });
      const head = await input.storage.headObject({
        bucket: input.cleanBucket,
        key: file.objectKey,
      });
      if (!copied.etag || copied.etag !== head.etag || head.contentLength !== file.sizeBytes)
        throw new LifecycleError('STORAGE_PROMOTE_MISMATCH');
      promotedEtag = head.etag;
    }
    const now = new Date();
    if (!job.leaseExpiresAt || job.leaseExpiresAt <= now)
      throw new LifecycleError('SCAN_LEASE_LOST');
    const patch: NonNullable<GuardedTransitionInput['patch']> = {
      scannedAt: now,
      scanPolicyVersion: input.scanPolicyVersion ?? null,
      detectedContentType: input.detectedContentType ?? null,
    };
    if (promotedEtag) {
      patch.promotedAt = now;
      patch.etag = promotedEtag;
    }
    await transitionFile(
      {
        fileId: file.id,
        expectedRowVersion: input.expectedRowVersion,
        expectedStatus: 'scanning',
        toStatus: input.verdict,
        patch,
      },
      tx,
    );
    return { status: input.verdict };
  });
}

export async function abortFile(input: {
  fileId: string;
  expectedStatus: 'initiated' | 'uploading';
  expectedRowVersion: number;
  reason: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, input.fileId),
          eq(files.status, input.expectedStatus),
          eq(files.rowVersion, input.expectedRowVersion),
        ),
      )
      .for('update');
    if (!file) throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
    const [session] = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.fileId, file.id))
      .for('update');
    if (!session || session.declaredSizeBytes === null)
      throw new LifecycleError('UPLOAD_SESSION_INVALID');
    await tx.select().from(callers).where(eq(callers.id, file.callerId)).for('update');
    await tx
      .update(files)
      .set({
        status: 'failed',
        statusReason: input.reason,
        purgeAfter: new Date(),
        rowVersion: sql`${files.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(files.id, file.id));
    await tx
      .update(uploadSessions)
      .set({
        status: 'aborted',
        abortedAt: new Date(),
        abortReason: input.reason,
        rowVersion: sql`${uploadSessions.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(uploadSessions.id, session.id));
    const [usage] = await tx
      .update(callerUsage)
      .set({
        bytesReserved: sql`${callerUsage.bytesReserved} - ${session.declaredSizeBytes}`,
        rowVersion: sql`${callerUsage.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(callerUsage.callerId, file.callerId),
          sql`${callerUsage.bytesReserved} >= ${session.declaredSizeBytes}`,
        ),
      )
      .returning({ callerId: callerUsage.callerId });
    if (!usage) throw new LifecycleError('LIFECYCLE_FAILED');
  });
}

export async function markDeleted(input: {
  fileId: string;
  expectedStatus: 'clean' | 'infected' | 'rejected' | 'failed';
  expectedRowVersion: number;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .select({ id: scanJobs.id })
      .from(scanJobs)
      .where(eq(scanJobs.fileId, input.fileId))
      .for('update');
    const [file] = await tx
      .select()
      .from(files)
      .where(and(eq(files.id, input.fileId), eq(files.legalHold, false)))
      .for('update');
    if (!file || (file.retainUntil && file.retainUntil > new Date()))
      throw new LifecycleError('FILE_TRANSITION_INVALID');
    await transitionFile({ ...input, toStatus: 'deleted', patch: { deletedAt: new Date() } }, tx);
    await tx
      .update(scanJobs)
      .set({ status: 'cancelled', leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(scanJobs.fileId, file.id),
          sql`${scanJobs.status} IN ('pending', 'claimed', 'running')`,
        ),
      );
  });
}

export function assertDownloadable(status: FileStatus): void {
  if (!isDownloadableStatus(status)) throw new LifecycleError('FILE_NOT_DOWNLOADABLE');
}
export async function expireStaleUpload(input: {
  fileId: string;
  expectedStatus: 'initiated' | 'uploading';
  expectedRowVersion: number;
  reason: string;
}): Promise<void> {
  await abortFile(input);
}
export async function purgeFile(input: {
  fileId: string;
  expectedStatus: 'clean' | 'infected' | 'rejected' | 'failed' | 'deleted';
  expectedRowVersion: number;
  storage: LifecycleStorage;
  cleanBucket: string;
  quarantineBucket: string;
  forensicBucket: string | null;
}): Promise<void> {
  if (input.expectedStatus !== 'deleted')
    await markDeleted({
      fileId: input.fileId,
      expectedStatus: input.expectedStatus,
      expectedRowVersion: input.expectedRowVersion,
    });
  await db.transaction(async (tx) => {
    const [file] = await tx
      .select()
      .from(files)
      .where(
        and(
          eq(files.id, input.fileId),
          eq(files.status, 'deleted'),
          isNull(files.purgedAt),
          eq(files.legalHold, false),
        ),
      )
      .for('update');
    if (!file) return;
    if (file.retainUntil && file.retainUntil > new Date())
      throw new LifecycleError('FILE_TRANSITION_INVALID');
    for (const bucket of new Set([
      input.cleanBucket,
      input.quarantineBucket,
      input.forensicBucket,
    ])) {
      // oxlint-disable-next-line no-await-in-loop -- Keep transaction operations ordered and stop on the first failure.
      if (bucket) await input.storage.deleteObject({ bucket, key: file.objectKey });
    }
    if (file.uploadedAt) {
      await tx.select().from(callers).where(eq(callers.id, file.callerId)).for('update');
      await tx
        .update(callerUsage)
        .set({
          bytesUsed: sql`${callerUsage.bytesUsed} - ${file.sizeBytes ?? 0}`,
          fileCount: sql`${callerUsage.fileCount} - 1`,
          rowVersion: sql`${callerUsage.rowVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(callerUsage.callerId, file.callerId));
    }
    await tx
      .update(files)
      .set({
        purgedAt: new Date(),
        updatedAt: new Date(),
        rowVersion: sql`${files.rowVersion} + 1`,
      })
      .where(eq(files.id, file.id));
  });
}

export async function retireFailedScans(): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(files)
      .where(
        and(
          sql`${files.status} IN ('quarantined', 'scanning')`,
          sql`exists (select 1 from ${scanJobs} where ${scanJobs.fileId} = ${files.id} and ${scanJobs.status} = 'failed')`,
          sql`not exists (select 1 from ${scanJobs} where ${scanJobs.fileId} = ${files.id} and ${scanJobs.status} in ('pending', 'claimed', 'running'))`,
        ),
      )
      .limit(100)
      .for('update', { skipLocked: true });
    for (const file of rows) {
      // oxlint-disable-next-line no-await-in-loop -- Keep transaction operations ordered and stop on the first failure.
      await tx
        .update(files)
        .set({
          status: 'failed',
          statusReason: 'SCAN_ATTEMPTS_EXHAUSTED',
          purgeAfter: file.purgeAfter ?? new Date(Date.now() + 86_400_000),
          rowVersion: sql`${files.rowVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(files.id, file.id), eq(files.rowVersion, file.rowVersion)));
    }
    return rows.length;
  });
}
