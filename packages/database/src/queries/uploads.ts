import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '../client.ts';
import { uploadParts, uploadSessions } from '../tables/index.ts';

export type UploadSessionMode = 'proxy_single' | 'proxy_parts';
export type UploadSessionRecord = typeof uploadSessions.$inferSelect;
export type UploadPartRecord = typeof uploadParts.$inferSelect;

export async function loadUploadSessionByFileId(
  fileId: string,
): Promise<UploadSessionRecord | null> {
  const [session] = await db
    .select()
    .from(uploadSessions)
    .where(eq(uploadSessions.fileId, fileId))
    .limit(1);
  return session ?? null;
}
export async function attachMultipartUploadId(input: {
  uploadSessionId: string;
  multipartUploadId: string;
}): Promise<void> {
  const [session] = await db
    .update(uploadSessions)
    .set({
      multipartUploadId: input.multipartUploadId,
      status: 'uploading',
      rowVersion: sql`${uploadSessions.rowVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(uploadSessions.id, input.uploadSessionId),
        sql`${uploadSessions.status} IN ('initiated', 'uploading')`,
        gt(uploadSessions.expiresAt, new Date()),
        sql`${uploadSessions.multipartUploadId} IS NULL`,
      ),
    )
    .returning({ id: uploadSessions.id });
  if (!session) throw new Error('UPLOAD_SESSION_INVALID');
}
export async function recordUploadPart(input: {
  uploadSessionId: string;
  partNumber: number;
  sizeBytes: number;
  etag: string;
  checksumSha256: Buffer;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [session] = await tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, input.uploadSessionId))
      .for('update');
    if (
      session?.mode !== 'proxy_parts' ||
      session.status !== 'uploading' ||
      session.expiresAt <= new Date() ||
      session.declaredSizeBytes === null
    )
      throw new Error('UPLOAD_SESSION_INVALID');
    const [previous] = await tx
      .select()
      .from(uploadParts)
      .where(
        and(
          eq(uploadParts.uploadSessionId, session.id),
          eq(uploadParts.partNumber, input.partNumber),
        ),
      );
    const receivedSizeBytes =
      session.receivedSizeBytes - (previous?.sizeBytes ?? 0) + input.sizeBytes;
    if (!Number.isSafeInteger(receivedSizeBytes) || receivedSizeBytes > session.declaredSizeBytes)
      throw new Error('UPLOAD_SIZE_MISMATCH');
    await tx
      .insert(uploadParts)
      .values(input)
      .onConflictDoUpdate({
        target: [uploadParts.uploadSessionId, uploadParts.partNumber],
        set: {
          sizeBytes: input.sizeBytes,
          etag: input.etag,
          checksumSha256: input.checksumSha256,
          updatedAt: new Date(),
        },
      });
    await tx
      .update(uploadSessions)
      .set({
        receivedSizeBytes,
        partCount: session.partCount + (previous ? 0 : 1),
        rowVersion: sql`${uploadSessions.rowVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(uploadSessions.id, session.id));
  });
}
export async function listUploadParts(uploadSessionId: string): Promise<UploadPartRecord[]> {
  return db
    .select()
    .from(uploadParts)
    .where(eq(uploadParts.uploadSessionId, uploadSessionId))
    .orderBy(uploadParts.partNumber);
}
export async function markUploadSessionStatus(input: {
  uploadSessionId: string;
  status: UploadSessionRecord['status'];
  abortReason?: string;
}): Promise<void> {
  const [session] = await db
    .update(uploadSessions)
    .set({
      status: input.status,
      abortReason: input.abortReason,
      rowVersion: sql`${uploadSessions.rowVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(uploadSessions.id, input.uploadSessionId),
        sql`${uploadSessions.status} IN ('initiated', 'uploading', 'completing')`,
        gt(uploadSessions.expiresAt, new Date()),
      ),
    )
    .returning({ id: uploadSessions.id });
  if (!session) throw new Error('UPLOAD_SESSION_INVALID');
}
