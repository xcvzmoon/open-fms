import { eq } from 'drizzle-orm';
import { db } from '../client.ts';
import { uploadParts, uploadSessions } from '../tables/index.ts';

export type UploadSessionMode = 'proxy_single' | 'proxy_parts' | 'direct';

export type UploadSessionRecord = {
  id: string;
  fileId: string;
  callerId: string;
  mode: UploadSessionMode;
  status: 'initiated' | 'uploading' | 'completing' | 'completed' | 'aborted' | 'expired';
  multipartUploadId: string | null;
  receivedSizeBytes: number;
  partCount: number;
  expiresAt: Date;
  rowVersion: number;
};

export type UploadPartRecord = {
  id: string;
  uploadSessionId: string;
  partNumber: number;
  sizeBytes: number;
  etag: string;
  checksumSha256: Buffer | null;
};

function toUploadSessionRecord(row: {
  id: string;
  fileId: string;
  callerId: string;
  mode: UploadSessionMode;
  status: UploadSessionRecord['status'];
  multipartUploadId: string | null;
  receivedSizeBytes: number;
  partCount: number;
  expiresAt: Date;
  rowVersion: number;
}): UploadSessionRecord {
  return {
    id: row.id,
    fileId: row.fileId,
    callerId: row.callerId,
    mode: row.mode,
    status: row.status,
    multipartUploadId: row.multipartUploadId,
    receivedSizeBytes: row.receivedSizeBytes,
    partCount: row.partCount,
    expiresAt: row.expiresAt,
    rowVersion: row.rowVersion,
  };
}

export async function loadUploadSessionByFileId(
  fileId: string,
): Promise<UploadSessionRecord | null> {
  const rows = await db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.fileId, fileId))
    .limit(1);
  const row = rows[0];
  return row ? toUploadSessionRecord(row) : null;
}

export async function attachMultipartUploadId(input: {
  uploadSessionId: string;
  multipartUploadId: string;
}): Promise<void> {
  await db
    .update(uploadSessions)
    .set({
      multipartUploadId: input.multipartUploadId,
      status: 'uploading',
      updatedAt: new Date(),
    })
    .where(eq(uploadSessions.id, input.uploadSessionId));
}

export async function recordUploadPart(input: {
  uploadSessionId: string;
  partNumber: number;
  sizeBytes: number;
  etag: string;
  checksumSha256: Buffer;
}): Promise<void> {
  await db
    .insert(uploadParts)
    .values({
      uploadSessionId: input.uploadSessionId,
      partNumber: input.partNumber,
      sizeBytes: input.sizeBytes,
      etag: input.etag,
      checksumSha256: input.checksumSha256,
    })
    .onConflictDoUpdate({
      target: [uploadParts.uploadSessionId, uploadParts.partNumber],
      set: {
        sizeBytes: input.sizeBytes,
        etag: input.etag,
        checksumSha256: input.checksumSha256,
        updatedAt: new Date(),
      },
    });

  const partRows = await db
    .select({ sizeBytes: uploadParts.sizeBytes })
    .from(uploadParts)
    .where(eq(uploadParts.uploadSessionId, input.uploadSessionId));
  let receivedSizeBytes = 0;
  for (const part of partRows) {
    receivedSizeBytes += part.sizeBytes;
  }

  await db
    .update(uploadSessions)
    .set({
      receivedSizeBytes,
      partCount: partRows.length,
      status: 'uploading',
      updatedAt: new Date(),
    })
    .where(eq(uploadSessions.id, input.uploadSessionId));
}

export async function listUploadParts(uploadSessionId: string): Promise<UploadPartRecord[]> {
  const rows = await db
    .select()
    .from(uploadParts)
    .where(eq(uploadParts.uploadSessionId, uploadSessionId))
    .orderBy(uploadParts.partNumber);
  return rows.map((row) => ({
    id: row.id,
    uploadSessionId: row.uploadSessionId,
    partNumber: row.partNumber,
    sizeBytes: row.sizeBytes,
    etag: row.etag,
    checksumSha256: row.checksumSha256,
  }));
}

export async function markUploadSessionStatus(input: {
  uploadSessionId: string;
  status: 'uploading' | 'completing' | 'completed' | 'aborted' | 'expired';
  abortReason?: string | null;
}): Promise<void> {
  const now = new Date();
  if (input.status === 'completed') {
    await db
      .update(uploadSessions)
      .set({ status: input.status, completedAt: now, updatedAt: now })
      .where(eq(uploadSessions.id, input.uploadSessionId));
    return;
  }
  if (input.status === 'aborted') {
    await db
      .update(uploadSessions)
      .set({
        status: input.status,
        abortedAt: now,
        abortReason: input.abortReason ?? null,
        updatedAt: now,
      })
      .where(eq(uploadSessions.id, input.uploadSessionId));
    return;
  }
  await db
    .update(uploadSessions)
    .set({ status: input.status, updatedAt: now })
    .where(eq(uploadSessions.id, input.uploadSessionId));
}
