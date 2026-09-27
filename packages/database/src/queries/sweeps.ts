import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../client.ts';
import { files, scanJobs, setupCodes, uploadPasses, uploadSessions } from '../tables/index.ts';

export type StaleUploadFile = {
  id: string;
  callerId: string;
  rowVersion: number;
  status: 'initiated' | 'uploading';
  sizeBytes: number | null;
};

export type PurgeableFile = {
  id: string;
  status: 'clean' | 'infected' | 'rejected' | 'failed';
  rowVersion: number;
};

export async function listStaleUploadFiles(now = new Date()): Promise<StaleUploadFile[]> {
  const rows = await db
    .select({
      id: files.id,
      callerId: files.callerId,
      rowVersion: files.rowVersion,
      status: files.status,
      sizeBytes: files.sizeBytes,
    })
    .from(files)
    .where(
      and(
        sql`${files.status} IN ('initiated', 'uploading')`,
        lt(files.updatedAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
        isNull(files.deletedAt),
      ),
    )
    .limit(100);

  const result: StaleUploadFile[] = [];
  for (const row of rows) {
    if (row.status === 'initiated' || row.status === 'uploading') {
      result.push({
        id: row.id,
        callerId: row.callerId,
        rowVersion: row.rowVersion,
        status: row.status,
        sizeBytes: row.sizeBytes,
      });
    }
  }
  return result;
}

export async function listPurgeableFiles(now = new Date()): Promise<PurgeableFile[]> {
  const rows = await db
    .select({
      id: files.id,
      status: files.status,
      rowVersion: files.rowVersion,
    })
    .from(files)
    .where(
      and(
        isNotNull(files.purgeAfter),
        lt(files.purgeAfter, now),
        sql`${files.status} IN ('clean', 'infected', 'rejected', 'failed')`,
        isNull(files.deletedAt),
        eq(files.legalHold, false),
      ),
    )
    .limit(100);

  const result: PurgeableFile[] = [];
  for (const row of rows) {
    if (
      row.status === 'clean' ||
      row.status === 'infected' ||
      row.status === 'rejected' ||
      row.status === 'failed'
    ) {
      result.push({
        id: row.id,
        status: row.status,
        rowVersion: row.rowVersion,
      });
    }
  }
  return result;
}

export async function expireSetupCodes(now = new Date()): Promise<number> {
  const deleted = await db
    .delete(setupCodes)
    .where(and(isNull(setupCodes.redeemedAt), lt(setupCodes.expiresAt, now)))
    .returning({ id: setupCodes.id });
  return deleted.length;
}

export async function expireUploadPasses(now = new Date()): Promise<number> {
  const updated = await db
    .update(uploadPasses)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        isNull(uploadPasses.usedAt),
        isNull(uploadPasses.revokedAt),
        lt(uploadPasses.expiresAt, now),
      ),
    )
    .returning({ id: uploadPasses.id });
  return updated.length;
}

export async function expireUploadSessions(now = new Date()): Promise<number> {
  const updated = await db
    .update(uploadSessions)
    .set({
      status: 'expired',
      updatedAt: now,
      rowVersion: sql`${uploadSessions.rowVersion} + 1`,
    })
    .where(
      and(
        sql`${uploadSessions.status} IN ('initiated', 'uploading')`,
        lt(uploadSessions.expiresAt, now),
      ),
    )
    .returning({ id: uploadSessions.id });
  return updated.length;
}

export async function reclaimScanLeases(now = new Date()): Promise<number> {
  const updated = await db
    .update(scanJobs)
    .set({
      status: 'pending',
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      rowVersion: sql`${scanJobs.rowVersion} + 1`,
      updatedAt: now,
    })
    .where(and(eq(scanJobs.status, 'claimed'), lt(scanJobs.leaseExpiresAt, now)))
    .returning({ id: scanJobs.id });
  return updated.length;
}
