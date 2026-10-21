import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../client.ts';
import { files, uploadSessions } from '../tables/index.ts';

export { reclaimExpiredScanLeases as reclaimScanLeases } from './scan-jobs.ts';

export type StaleUploadFile = {
  id: string;
  callerId: string;
  rowVersion: number;
  status: 'initiated' | 'uploading';
  sizeBytes: number | null;
  storageBackendId: string;
  objectKey: string;
};
export type PurgeableFile = {
  id: string;
  callerId: string;
  storageBackendId: string;
  objectKey: string;
  status: 'clean' | 'infected' | 'rejected' | 'failed' | 'deleted';
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
      storageBackendId: files.storageBackendId,
      objectKey: files.objectKey,
    })
    .from(files)
    .innerJoin(uploadSessions, eq(uploadSessions.fileId, files.id))
    .where(
      and(
        sql`${files.status} IN ('initiated', 'uploading')`,
        lte(uploadSessions.expiresAt, now),
        isNull(files.deletedAt),
      ),
    )
    .limit(100);
  const result: StaleUploadFile[] = [];
  for (const row of rows)
    if (row.status === 'initiated' || row.status === 'uploading')
      result.push({ ...row, status: row.status });
  return result;
}
export async function listPurgeableFiles(now = new Date()): Promise<PurgeableFile[]> {
  const rows = await db
    .select({
      id: files.id,
      callerId: files.callerId,
      storageBackendId: files.storageBackendId,
      objectKey: files.objectKey,
      status: files.status,
      rowVersion: files.rowVersion,
    })
    .from(files)
    .where(
      and(
        lte(files.purgeAfter, now),
        or(isNull(files.retainUntil), lte(files.retainUntil, now)),
        sql`${files.status} IN ('clean', 'infected', 'rejected', 'failed', 'deleted')`,
        isNull(files.purgedAt),
        eq(files.legalHold, false),
      ),
    )
    .limit(100);
  const result: PurgeableFile[] = [];
  for (const row of rows)
    if (
      row.status === 'clean' ||
      row.status === 'infected' ||
      row.status === 'rejected' ||
      row.status === 'failed' ||
      row.status === 'deleted'
    )
      result.push({ ...row, status: row.status });
  return result;
}
