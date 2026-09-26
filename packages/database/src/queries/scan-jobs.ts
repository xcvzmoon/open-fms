import { and, eq, lte, sql } from 'drizzle-orm';
import * as v from 'valibot';
import { db } from '../client.ts';
import { scanJobs } from '../tables/index.ts';

export type ClaimedScanJob = {
  id: string;
  fileId: string;
  attemptCount: number;
  maxAttempts: number;
};

const claimedRowSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  file_id: v.pipe(v.string(), v.minLength(1)),
  attempt_count: v.pipe(v.number(), v.integer(), v.minValue(0)),
  max_attempts: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export type ScanJobFileContext = {
  jobId: string;
  fileId: string;
  callerId: string;
  storageBackendId: string;
  objectKey: string;
  checksumSha256: Buffer | null;
  sizeBytes: number | null;
  sealedEtag: string | null;
  rowVersion: number;
  scanPolicyVersion: string | null;
};

/**
 * Claims one ready scan job with `FOR UPDATE SKIP LOCKED`.
 */
export async function claimNextScanJob(workerId: string): Promise<ClaimedScanJob | null> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  return db.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      SELECT id, file_id, attempt_count, max_attempts
      FROM fms.scan_jobs
      WHERE status = 'pending'
        AND available_at <= ${now}
      ORDER BY priority DESC, available_at ASC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const parsed = v.safeParse(claimedRowSchema, claimed[0]);
    if (!parsed.success) {
      return null;
    }
    const row = parsed.output;

    const updated = await tx
      .update(scanJobs)
      .set({
        status: 'claimed',
        claimedAt: now,
        claimedBy: workerId,
        leaseExpiresAt,
        rowVersion: sql`${scanJobs.rowVersion} + 1`,
        updatedAt: now,
      })
      .where(and(eq(scanJobs.id, row.id), eq(scanJobs.status, 'pending')))
      .returning({ id: scanJobs.id });

    if (!updated[0]) {
      return null;
    }

    return {
      id: row.id,
      fileId: row.file_id,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
    };
  });
}

export async function markScanJobRunning(jobId: string): Promise<void> {
  await db
    .update(scanJobs)
    .set({
      status: 'running',
      startedAt: new Date(),
      rowVersion: sql`${scanJobs.rowVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(scanJobs.id, jobId));
}

export async function completeScanJob(jobId: string): Promise<void> {
  await db
    .update(scanJobs)
    .set({
      status: 'succeeded',
      finishedAt: new Date(),
      rowVersion: sql`${scanJobs.rowVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(scanJobs.id, jobId));
}

export async function failScanJob(input: {
  jobId: string;
  reason: string;
  retry: boolean;
}): Promise<void> {
  const now = new Date();
  const status = input.retry ? 'pending' : 'failed';
  await db
    .update(scanJobs)
    .set({
      status,
      attemptCount: sql`${scanJobs.attemptCount} + 1`,
      lastError: input.reason,
      availableAt: new Date(now.getTime() + 60_000),
      finishedAt: input.retry ? null : now,
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      rowVersion: sql`${scanJobs.rowVersion} + 1`,
      updatedAt: now,
    })
    .where(eq(scanJobs.id, input.jobId));
}

export async function reclaimExpiredScanLeases(now = new Date()): Promise<number> {
  const expired = await db
    .update(scanJobs)
    .set({
      status: 'pending',
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      rowVersion: sql`${scanJobs.rowVersion} + 1`,
      updatedAt: now,
    })
    .where(and(eq(scanJobs.status, 'claimed'), lte(scanJobs.leaseExpiresAt, now)))
    .returning({ id: scanJobs.id });
  return expired.length;
}
