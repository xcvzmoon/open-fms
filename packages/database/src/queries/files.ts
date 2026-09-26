import { and, eq } from 'drizzle-orm';
import { db } from '../client.ts';
import { files } from '../tables/index.ts';

export type FileRecord = {
  id: string;
  callerId: string;
  storageBackendId: string;
  objectKey: string;
  status: string;
  rowVersion: number;
  sizeBytes: number | null;
  etag: string | null;
  sealedEtag: string | null;
};

export async function loadFileForCaller(
  fileId: string,
  callerId: string,
): Promise<FileRecord | null> {
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.callerId, callerId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    callerId: row.callerId,
    storageBackendId: row.storageBackendId,
    objectKey: row.objectKey,
    status: row.status,
    rowVersion: row.rowVersion,
    sizeBytes: row.sizeBytes,
    etag: row.etag,
    sealedEtag: row.sealedEtag,
  };
}
