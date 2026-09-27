import { callerUsage, callers, db, files, scanJobs, uploadSessions } from '@open-fms/database';
import { and, eq, sql } from 'drizzle-orm';
import { canTransition, isDownloadableStatus, type FileStatus } from './status.ts';
import { LifecycleError, type LifecycleStorage } from './types.ts';

export type CreateFileInput = {
  callerId: string;
  storageBackendId: string;
  objectKey: string;
  originalFilename: string;
  declaredContentType: string | null;
  declaredSizeBytes: number | null;
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
  patch?: Record<string, string | number | boolean | Date | null | undefined>;
};

async function assertQuotaAvailable(callerId: string, reserveBytes: number): Promise<void> {
  const callerRows = await db
    .select({ quotaBytes: callers.quotaBytes })
    .from(callers)
    .where(eq(callers.id, callerId))
    .limit(1);
  const caller = callerRows[0];
  if (!caller) {
    throw new LifecycleError('FILE_NOT_FOUND');
  }
  if (caller.quotaBytes === null) {
    return;
  }

  const usageRows = await db
    .select({
      bytesReserved: callerUsage.bytesReserved,
      bytesUsed: callerUsage.bytesUsed,
    })
    .from(callerUsage)
    .where(eq(callerUsage.callerId, callerId))
    .limit(1);
  const usage = usageRows[0];
  const reserved = usage?.bytesReserved ?? 0;
  const used = usage?.bytesUsed ?? 0;
  if (used + reserved + reserveBytes > caller.quotaBytes) {
    throw new LifecycleError('QUOTA_EXCEEDED');
  }
}

async function transitionFile(input: GuardedTransitionInput): Promise<void> {
  if (!canTransition(input.expectedStatus, input.toStatus)) {
    throw new LifecycleError('FILE_TRANSITION_INVALID');
  }

  const updated = await db
    .update(files)
    .set({
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

  if (!updated[0]) {
    throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
  }
}

export async function createFileWithUploadSession(input: CreateFileInput): Promise<CreatedFile> {
  const reserveBytes = input.declaredSizeBytes ?? 0;
  await assertQuotaAvailable(input.callerId, reserveBytes);

  return db.transaction(async (tx) => {
    const fileRows = await tx
      .insert(files)
      .values({
        callerId: input.callerId,
        storageBackendId: input.storageBackendId,
        objectKey: input.objectKey,
        originalFilename: input.originalFilename,
        declaredContentType: input.declaredContentType,
        sizeBytes: input.declaredSizeBytes,
        ownerRef: input.ownerRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        status: 'initiated',
        rowVersion: 1,
      })
      .returning({ id: files.id });
    const fileRow = fileRows[0];
    if (!fileRow) {
      throw new LifecycleError('LIFECYCLE_FAILED');
    }

    const sessionRows = await tx
      .insert(uploadSessions)
      .values({
        fileId: fileRow.id,
        callerId: input.callerId,
        status: 'initiated',
        declaredSizeBytes: input.declaredSizeBytes,
        expiresAt: input.expiresAt,
        rowVersion: 1,
      })
      .returning({ id: uploadSessions.id });
    const sessionRow = sessionRows[0];
    if (!sessionRow) {
      throw new LifecycleError('LIFECYCLE_FAILED');
    }

    await tx
      .insert(callerUsage)
      .values({
        callerId: input.callerId,
        bytesReserved: reserveBytes,
        bytesUsed: 0,
        fileCount: 0,
      })
      .onConflictDoUpdate({
        target: callerUsage.callerId,
        set: {
          bytesReserved: sql`${callerUsage.bytesReserved} + ${reserveBytes}`,
          updatedAt: new Date(),
          rowVersion: sql`${callerUsage.rowVersion} + 1`,
        },
      });

    return {
      fileId: fileRow.id,
      uploadSessionId: sessionRow.id,
      objectKey: input.objectKey,
      status: 'initiated' as const,
    };
  });
}

export async function markUploading(input: {
  fileId: string;
  expectedRowVersion: number;
}): Promise<void> {
  await transitionFile({
    fileId: input.fileId,
    expectedStatus: 'initiated',
    expectedRowVersion: input.expectedRowVersion,
    toStatus: 'uploading',
    patch: {},
  });
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
    const updated = await tx
      .update(files)
      .set({
        status: 'quarantined',
        checksumSha256: input.checksumSha256,
        sizeBytes: input.sizeBytes,
        etag: input.etag,
        sealedEtag: input.sealedEtag,
        detectedContentType: input.detectedContentType,
        uploadedAt: new Date(),
        rowVersion: sql`${files.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.id, input.fileId),
          eq(files.status, 'uploading'),
          eq(files.rowVersion, input.expectedRowVersion),
        ),
      )
      .returning({
        id: files.id,
        callerId: files.callerId,
        sizeBytes: files.sizeBytes,
        rowVersion: files.rowVersion,
      });

    const fileRow = updated[0];
    if (!fileRow) {
      throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
    }

    await tx.insert(scanJobs).values({
      fileId: input.fileId,
      status: 'pending',
      availableAt: new Date(),
      rowVersion: 1,
    });

    const size = input.sizeBytes;
    await tx
      .update(callerUsage)
      .set({
        bytesReserved: sql`GREATEST(0, ${callerUsage.bytesReserved} - ${size})`,
        bytesUsed: sql`${callerUsage.bytesUsed} + ${size}`,
        fileCount: sql`${callerUsage.fileCount} + 1`,
        updatedAt: new Date(),
        rowVersion: sql`${callerUsage.rowVersion} + 1`,
      })
      .where(eq(callerUsage.callerId, fileRow.callerId));

    return {
      status: 'quarantined' as const,
      rowVersion: fileRow.rowVersion,
    };
  });
}

export async function markScanning(input: {
  fileId: string;
  expectedRowVersion: number;
}): Promise<void> {
  await transitionFile({
    fileId: input.fileId,
    expectedStatus: 'quarantined',
    expectedRowVersion: input.expectedRowVersion,
    toStatus: 'scanning',
  });
}

export async function applyScanVerdict(input: {
  fileId: string;
  expectedRowVersion: number;
  verdict: 'clean' | 'infected' | 'rejected';
  storage: LifecycleStorage;
  cleanBucket: string;
  quarantineBucket: string;
  objectKey: string;
  sealedEtag: string;
  scanPolicyVersion?: string | null;
}): Promise<{ status: FileStatus }> {
  if (input.verdict === 'clean') {
    const copied = await input.storage.copyObject({
      sourceBucket: input.quarantineBucket,
      sourceKey: input.objectKey,
      destinationBucket: input.cleanBucket,
      destinationKey: input.objectKey,
    });
    const head = await input.storage.headObject({
      bucket: input.cleanBucket,
      key: input.objectKey,
    });
    if (copied.etag !== input.sealedEtag && head.etag !== input.sealedEtag) {
      throw new LifecycleError('STORAGE_PROMOTE_MISMATCH');
    }

    await transitionFile({
      fileId: input.fileId,
      expectedStatus: 'scanning',
      expectedRowVersion: input.expectedRowVersion,
      toStatus: 'clean',
      patch: {
        scannedAt: new Date(),
        promotedAt: new Date(),
        scanPolicyVersion: input.scanPolicyVersion ?? null,
      },
    });
    return { status: 'clean' };
  }

  await transitionFile({
    fileId: input.fileId,
    expectedStatus: 'scanning',
    expectedRowVersion: input.expectedRowVersion,
    toStatus: input.verdict,
    patch: {
      scannedAt: new Date(),
      scanPolicyVersion: input.scanPolicyVersion ?? null,
    },
  });
  return { status: input.verdict };
}

export async function abortFile(input: {
  fileId: string;
  expectedStatus: 'initiated' | 'uploading';
  expectedRowVersion: number;
  reason: string;
  reservedBytes: number;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const updated = await tx
      .update(files)
      .set({
        status: 'failed',
        statusReason: input.reason,
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
      .returning({ callerId: files.callerId });
    const row = updated[0];
    if (!row) {
      throw new LifecycleError('FILE_ROW_VERSION_CONFLICT');
    }

    await tx
      .update(callerUsage)
      .set({
        bytesReserved: sql`GREATEST(0, ${callerUsage.bytesReserved} - ${input.reservedBytes})`,
        updatedAt: new Date(),
        rowVersion: sql`${callerUsage.rowVersion} + 1`,
      })
      .where(eq(callerUsage.callerId, row.callerId));
  });
}

export async function markDeleted(input: {
  fileId: string;
  expectedStatus: FileStatus;
  expectedRowVersion: number;
}): Promise<void> {
  await transitionFile({
    fileId: input.fileId,
    expectedStatus: input.expectedStatus,
    expectedRowVersion: input.expectedRowVersion,
    toStatus: 'deleted',
    patch: {
      deletedAt: new Date(),
    },
  });
}

export function assertDownloadable(status: FileStatus): void {
  if (!isDownloadableStatus(status)) {
    throw new LifecycleError('FILE_NOT_DOWNLOADABLE');
  }
}

export async function expireStaleUpload(input: {
  fileId: string;
  expectedStatus: 'initiated' | 'uploading';
  expectedRowVersion: number;
  reservedBytes: number;
  reason: string;
}): Promise<void> {
  await abortFile(input);
}

export async function purgeFile(input: {
  fileId: string;
  expectedStatus: 'clean' | 'infected' | 'rejected' | 'failed';
  expectedRowVersion: number;
}): Promise<void> {
  await markDeleted(input);
}
