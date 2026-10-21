import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as v from 'valibot';
import { db } from '../client.ts';
import { callers, scanJobs } from '../tables/index.ts';

export type ClaimedScanJob = {
  id: string;
  fileId: string;
  attemptCount: number;
  maxAttempts: number;
  leaseToken: string;
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
export async function claimNextScanJob(
  workerId: string,
  leaseMs = 300_000,
): Promise<ClaimedScanJob | null> {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseMs);

  return db.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      SELECT id, file_id, attempt_count, max_attempts
      FROM fms.scan_jobs
      WHERE status = 'pending'
        AND available_at <= ${now.toISOString()}
        AND attempt_count < max_attempts
      ORDER BY priority DESC, available_at ASC, created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `);

    const parsed = v.safeParse(claimedRowSchema, claimed[0]);
    if (!parsed.success) {
      return null;
    }
    const row = parsed.output;

    const leaseToken = randomUUID();
    const updated = await tx
      .update(scanJobs)
      .set({
        status: 'claimed',
        leaseToken,
        attemptCount: sql`${scanJobs.attemptCount} + 1`,
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
      attemptCount: row.attempt_count + 1,
      leaseToken,
      maxAttempts: row.max_attempts,
    };
  });
}

function ownedLease(jobId: string, leaseToken: string) {
  return and(
    eq(scanJobs.id, jobId),
    eq(scanJobs.leaseToken, leaseToken),
    inArray(scanJobs.status, ['claimed', 'running']),
    gt(scanJobs.leaseExpiresAt, sql`clock_timestamp()`),
  );
}

export async function markScanJobRunning(jobId: string, leaseToken: string): Promise<boolean> {
  const rows = await db
    .update(scanJobs)
    .set({ status: 'running', startedAt: new Date() })
    .where(and(ownedLease(jobId, leaseToken), eq(scanJobs.status, 'claimed')))
    .returning({ id: scanJobs.id });
  return rows.length === 1;
}

export async function heartbeatScanJob(
  jobId: string,
  leaseToken: string,
  leaseMs: number,
): Promise<boolean> {
  const rows = await db
    .update(scanJobs)
    .set({ leaseExpiresAt: new Date(Date.now() + leaseMs) })
    .where(ownedLease(jobId, leaseToken))
    .returning({ id: scanJobs.id });
  return rows.length === 1;
}

export async function completeScanJob(jobId: string, leaseToken: string): Promise<boolean> {
  const rows = await db
    .update(scanJobs)
    .set({
      status: 'succeeded',
      finishedAt: new Date(),
      leaseToken: null,
      claimedBy: null,
      leaseExpiresAt: null,
    })
    .where(and(ownedLease(jobId, leaseToken), eq(scanJobs.status, 'running')))
    .returning({ id: scanJobs.id });
  return rows.length === 1;
}

export async function failScanJob(input: {
  jobId: string;
  leaseToken: string;
  reason: string;
  retry: boolean;
}): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(scanJobs)
    .set({
      status: input.retry
        ? sql`CASE WHEN ${scanJobs.attemptCount} < ${scanJobs.maxAttempts} THEN 'pending' ELSE 'failed' END`
        : 'failed',
      lastError: sql`CASE WHEN ${scanJobs.attemptCount} >= ${scanJobs.maxAttempts} THEN 'SCAN_ATTEMPTS_EXHAUSTED' ELSE ${input.reason} END`,
      availableAt: new Date(now.getTime() + 60_000),
      finishedAt: input.retry
        ? sql`CASE WHEN ${scanJobs.attemptCount} >= ${scanJobs.maxAttempts} THEN ${now.toISOString()}::timestamptz ELSE NULL END`
        : now,
      claimedAt: null,
      claimedBy: null,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(ownedLease(input.jobId, input.leaseToken))
    .returning({ id: scanJobs.id });
  return rows.length === 1;
}

export async function reclaimExpiredScanLeases(now = new Date()): Promise<number> {
  const rows = await db
    .update(scanJobs)
    .set({
      status: sql`CASE WHEN ${scanJobs.attemptCount} >= ${scanJobs.maxAttempts} THEN 'failed' ELSE 'pending' END`,
      lastError: sql`CASE WHEN ${scanJobs.attemptCount} >= ${scanJobs.maxAttempts} THEN 'SCAN_ATTEMPTS_EXHAUSTED' ELSE 'SCAN_LEASE_EXPIRED' END`,
      finishedAt: sql`CASE WHEN ${scanJobs.attemptCount} >= ${scanJobs.maxAttempts} THEN ${now.toISOString()}::timestamptz ELSE NULL END`,
      claimedAt: null,
      claimedBy: null,
      leaseToken: null,
      leaseExpiresAt: null,
      updatedAt: now,
    })
    .where(and(inArray(scanJobs.status, ['claimed', 'running']), lte(scanJobs.leaseExpiresAt, now)))
    .returning({ id: scanJobs.id });
  return rows.length;
}

export async function loadScanCallerPolicy(callerId: string): Promise<{
  maxFileSizeBytes: number;
  allowedContentTypes: string[];
} | null> {
  const [caller] = await db
    .select({
      maxFileSizeBytes: callers.maxFileSizeBytes,
      allowedContentTypes: callers.allowedContentTypes,
    })
    .from(callers)
    .where(and(eq(callers.id, callerId), eq(callers.status, 'active'), isNull(callers.deletedAt)))
    .limit(1);
  return caller ?? null;
}
