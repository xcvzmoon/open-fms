import { and, eq, isNull, ne } from 'drizzle-orm';
import { db } from '../client.ts';
import { callerCredentials, callers, files, storageBackends } from '../tables/index.ts';

export type ReconcileMismatch = {
  fileId: string;
  objectKey: string;
  expected: 'object_present' | 'object_missing';
  observed: 'object_present' | 'object_missing';
};

export type ReconcileResult = {
  checked: number;
  mismatches: ReconcileMismatch[];
};

export type ReconcileStorage = {
  headObject(location: {
    bucket: string;
    key: string;
  }): Promise<{ etag: string; contentLength: number }>;
};

export type ReconcileCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
};

async function loadLiveFiles() {
  return db
    .select({
      id: files.id,
      objectKey: files.objectKey,
      status: files.status,
      storageBackendId: files.storageBackendId,
    })
    .from(files)
    .where(and(isNull(files.deletedAt), ne(files.status, 'initiated')));
}

/**
 * Compares PostgreSQL file state with storage HEAD results.
 * Reports mismatches only; does not change status.
 */
export async function reconcileFileObjects(input: {
  storageForBackend: (backendId: string) => Promise<ReconcileStorage | null>;
}): Promise<ReconcileResult> {
  const rows = await loadLiveFiles();
  const backendIds = [...new Set(rows.map((row) => row.storageBackendId))];
  const backendById = new Map<string, { cleanBucket: string; quarantineBucket: string }>();
  await Promise.all(
    backendIds.map(async (backendId) => {
      const backendRows = await db
        .select()
        .from(storageBackends)
        .where(eq(storageBackends.id, backendId))
        .limit(1);
      const backend = backendRows[0];
      if (backend) {
        backendById.set(backendId, {
          cleanBucket: backend.cleanBucket,
          quarantineBucket: backend.quarantineBucket,
        });
      }
    }),
  );

  const results = await Promise.all(
    rows.map(async (row) => {
      const backend = backendById.get(row.storageBackendId);
      if (!backend) {
        return null;
      }
      const storage = await input.storageForBackend(row.storageBackendId);
      if (!storage) {
        return null;
      }
      const bucket = row.status === 'clean' ? backend.cleanBucket : backend.quarantineBucket;
      let observed: 'object_present' | 'object_missing' = 'object_missing';
      try {
        await storage.headObject({ bucket, key: row.objectKey });
        observed = 'object_present';
      } catch {
        observed = 'object_missing';
      }
      const expected: 'object_present' | 'object_missing' =
        row.status === 'clean' || row.status === 'scanning' || row.status === 'quarantined'
          ? 'object_present'
          : 'object_missing';
      return {
        mismatch:
          observed === expected
            ? null
            : {
                fileId: row.id,
                objectKey: row.objectKey,
                expected,
                observed,
              },
      };
    }),
  );

  const mismatches: ReconcileMismatch[] = [];
  let checked = 0;
  for (const result of results) {
    if (!result) {
      continue;
    }
    checked += 1;
    if (result.mismatch) {
      mismatches.push(result.mismatch);
    }
  }
  return { checked, mismatches };
}

export async function upsertCallerCredential(input: {
  callerId: string;
  keyId: string;
  secretHash: Buffer;
  pepperVersion: number;
  scopes: string[];
  allowedCidrs: string[];
  allowedTypes: string[];
  maxFileSizeBytes: number | null;
  rateLimitPerSec: number | null;
  expiresAt: Date;
}): Promise<void> {
  const existing = await db
    .select({ id: callerCredentials.id })
    .from(callerCredentials)
    .where(
      and(eq(callerCredentials.callerId, input.callerId), eq(callerCredentials.keyId, input.keyId)),
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(callerCredentials)
      .set({
        secretHash: input.secretHash,
        pepperVersion: input.pepperVersion,
        scopes: input.scopes,
        allowedCidrs: input.allowedCidrs,
        allowedTypes: input.allowedTypes,
        maxFileSizeBytes: input.maxFileSizeBytes,
        rateLimitPerSec: input.rateLimitPerSec,
        expiresAt: input.expiresAt,
        revokedAt: null,
        revokedReason: null,
      })
      .where(eq(callerCredentials.id, existing[0].id));
    return;
  }

  const callerRows = await db
    .select({ createdBy: callers.createdBy })
    .from(callers)
    .where(eq(callers.id, input.callerId))
    .limit(1);
  const callerRow = callerRows[0];
  if (!callerRow) {
    throw new Error('CALLER_NOT_FOUND');
  }

  await db.insert(callerCredentials).values({
    callerId: input.callerId,
    keyId: input.keyId,
    label: input.keyId,
    kind: 'standard',
    keyPrefix: input.keyId.slice(0, 8),
    secretHash: input.secretHash,
    pepperVersion: input.pepperVersion,
    scopes: input.scopes,
    allowedCidrs: input.allowedCidrs,
    allowedTypes: input.allowedTypes,
    maxFileSizeBytes: input.maxFileSizeBytes,
    rateLimitPerSec: input.rateLimitPerSec,
    createdBy: callerRow.createdBy,
    expiresAt: input.expiresAt,
  });
}
