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
  checksumSha256: Buffer | null;
  scanPolicyVersion: string | null;
};

function toFileRecord(row: {
  id: string;
  callerId: string;
  storageBackendId: string;
  objectKey: string;
  status:
    | 'initiated'
    | 'uploading'
    | 'uploaded'
    | 'quarantined'
    | 'scanning'
    | 'clean'
    | 'infected'
    | 'rejected'
    | 'failed'
    | 'deleted';
  rowVersion: number;
  sizeBytes: number | null;
  etag: string | null;
  sealedEtag: string | null;
  checksumSha256: Buffer | null;
  scanPolicyVersion: string | null;
}): FileRecord {
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
    checksumSha256: row.checksumSha256,
    scanPolicyVersion: row.scanPolicyVersion,
  };
}

export async function loadFileById(fileId: string): Promise<FileRecord | null> {
  const rows = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  const row = rows[0];
  return row ? toFileRecord(row) : null;
}

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
  return row ? toFileRecord(row) : null;
}
