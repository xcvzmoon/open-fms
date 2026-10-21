import { and, asc, eq, gt, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../client.ts';
import { files, storageBackends } from '../tables/index.ts';

export type ReconcileMismatch = {
  fileId: string;
  objectKey: string;
  expected: 'object_present' | 'object_missing';
  observed: 'object_present' | 'object_missing';
};
export type ReconcileResult = {
  checked: number;
  mismatches: ReconcileMismatch[];
  mismatchCount: number;
  truncated: boolean;
  storageErrorCount: number;
  storageErrors: { fileId: string; code: string }[];
};
export type ReconcileStorage = {
  headObject(location: {
    bucket: string;
    key: string;
  }): Promise<{ etag: string; contentLength: number }>;
  destroy(): void;
};
export type ReconcileCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
};
type ReconcileBackend = typeof storageBackends.$inferSelect;
type ReconcileRow = {
  id: string;
  objectKey: string;
  status: typeof files.$inferSelect.status;
  backend: ReconcileBackend | null;
};

async function* loadLiveFilePages(): AsyncGenerator<ReconcileRow[]> {
  let cursor: string | undefined;
  while (true) {
    const rows = await db
      .select({
        id: files.id,
        objectKey: files.objectKey,
        status: files.status,
        backend: storageBackends,
      })
      .from(files)
      .leftJoin(storageBackends, eq(files.storageBackendId, storageBackends.id))
      .where(
        and(
          isNull(files.deletedAt),
          isNotNull(files.uploadedAt),
          cursor ? gt(files.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(files.id))
      .limit(200);
    if (rows.length === 0) return;
    yield rows;
    cursor = rows.at(-1)?.id;
  }
}

export async function reconcileObjectPages(
  pages: AsyncIterable<ReconcileRow[]>,
  storageForBackend: (backend: ReconcileBackend) => Promise<ReconcileStorage | null>,
  isNotFound: (error: Error) => boolean,
  concurrency = 4,
): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    checked: 0,
    mismatches: [],
    mismatchCount: 0,
    truncated: false,
    storageErrorCount: 0,
    storageErrors: [],
  };
  const adapters = new Map<string, Promise<ReconcileStorage | null>>();
  const workers = Math.min(4, Math.max(1, Math.floor(concurrency) || 1));
  function recordError(fileId: string, code: string): void {
    result.storageErrorCount += 1;
    if (result.storageErrors.length < 1000) result.storageErrors.push({ fileId, code });
  }
  async function checkRow(row: ReconcileRow): Promise<void> {
    const backend = row.backend;
    if (!backend) {
      recordError(row.id, 'STORAGE_BACKEND_MISSING');
      return;
    }
    try {
      let pending = adapters.get(backend.id);
      if (!pending) {
        pending = Promise.resolve().then(() => storageForBackend(backend));
        adapters.set(backend.id, pending);
      }
      const storage = await pending;
      if (!storage) {
        recordError(row.id, 'STORAGE_UNAVAILABLE');
        return;
      }
      const bucket = row.status === 'clean' ? backend.cleanBucket : backend.quarantineBucket;
      let observed: ReconcileMismatch['observed'] = 'object_present';
      try {
        await storage.headObject({ bucket, key: row.objectKey });
      } catch (error) {
        if (!(error instanceof Error) || !isNotFound(error)) {
          recordError(row.id, 'STORAGE_HEAD_FAILED');
          return;
        }
        observed = 'object_missing';
      }
      result.checked += 1;
      const expected = 'object_present';
      if (observed !== expected) {
        result.mismatchCount += 1;
        if (result.mismatches.length < 1000) {
          result.mismatches.push({ fileId: row.id, objectKey: row.objectKey, expected, observed });
        }
      }
    } catch {
      recordError(row.id, 'STORAGE_ADAPTER_FAILED');
    }
  }
  try {
    for await (const rows of pages) {
      let next = 0;
      await Promise.all(
        Array.from({ length: workers }, async () => {
          while (next < rows.length) {
            const row = rows[next++];
            if (row) await checkRow(row);
          }
        }),
      );
    }
    result.truncated = result.mismatchCount > result.mismatches.length;
    return result;
  } finally {
    for (const pending of adapters.values()) {
      try {
        const adapter = await pending;
        adapter?.destroy();
      } catch {
        // Failed factories have no adapter to close.
      }
    }
  }
}

export async function reconcileFileObjects(
  storageForBackend: (backend: ReconcileBackend) => Promise<ReconcileStorage | null>,
  isNotFound: (error: Error) => boolean,
  concurrency = 4,
): Promise<ReconcileResult> {
  return reconcileObjectPages(loadLiveFilePages(), storageForBackend, isNotFound, concurrency);
}
