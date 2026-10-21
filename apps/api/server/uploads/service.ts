import {
  attachMultipartUploadId,
  db,
  uploadParts,
  loadFileForCaller,
  loadStorageBackend,
  loadUploadSessionByFileId,
  markUploadSessionStatus,
  recordUploadPart,
  type CallerContext,
  type FileRecord,
  type UploadPartRecord,
  type UploadSessionRecord,
} from '@open-fms/database';
import {
  abortFile,
  completeAndEnqueueScan,
  createFileWithUploadSession,
  LifecycleError,
  markUploading,
  type CreatedFile,
  type FileStatus,
  type UploadMode,
} from '@open-fms/lifecycle';
import { createStorageAdapter, isObjectNotFound, type S3StorageAdapter } from '@open-fms/storage';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as v from 'valibot';
import { hashBuffer, hashByteStream } from './hash.ts';

export type CreateUploadInput = {
  callerId: string;
  storageBackendId: string;
  originalFilename: string;
  declaredContentType: string | null;
  declaredSizeBytes: number;
  idempotencyKey?: string | null;
  mode: UploadMode;
};

export type UploadCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
};

export type SealedUploadResult = {
  status: FileStatus;
  rowVersion: number;
  sizeBytes: number;
  checksumSha256: string;
  etag: string;
};

export type ResumablePartResult = {
  etag: string;
  checksumSha256: string;
  sizeBytes: number;
};

export function buildObjectKey(callerId: string, fileId: string, prefix = 'sealed'): string {
  return `${callerId}/${prefix}/${fileId}`;
}

export async function startUpload(input: CreateUploadInput): Promise<CreatedFile> {
  const objectKey = buildObjectKey(input.callerId, randomUUID());
  return createFileWithUploadSession({
    callerId: input.callerId,
    storageBackendId: input.storageBackendId,
    objectKey,
    originalFilename: input.originalFilename,
    declaredContentType: input.declaredContentType,
    declaredSizeBytes: input.declaredSizeBytes,
    mode: input.mode,
    idempotencyKey: input.idempotencyKey ?? null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
}

export async function loadOwnedFile(fileId: string, callerId: string): Promise<FileRecord> {
  const file = await loadFileForCaller(fileId, callerId);
  if (!file) {
    throw new LifecycleError('FILE_NOT_FOUND');
  }
  return file;
}

export async function loadOwnedUploadSession(fileId: string): Promise<UploadSessionRecord> {
  const session = await loadUploadSessionByFileId(fileId);
  if (!session) {
    throw new LifecycleError('FILE_NOT_FOUND');
  }
  return session;
}

export async function resolveStorageAdapter(
  storageBackendId: string,
  credentials: UploadCredentials,
): Promise<S3StorageAdapter> {
  const backend = await loadStorageBackend(storageBackendId);
  if (!backend) {
    throw new LifecycleError('FILE_NOT_FOUND');
  }
  return createStorageAdapter({
    config: {
      id: backend.id,
      name: backend.name,
      kind: backend.kind,
      endpoint: backend.endpoint,
      region: backend.region,
      quarantineBucket: backend.quarantineBucket,
      cleanBucket: backend.cleanBucket,
      forensicBucket: backend.forensicBucket,
      credentialRef: backend.credentialRef,
      forcePathStyle: backend.kind !== 's3',
    },
    credentials,
  });
}

export async function ensureMultipartUpload(input: {
  session: UploadSessionRecord;
  storage: S3StorageAdapter;
  objectKey: string;
  contentType?: string | undefined;
  signal: AbortSignal;
}): Promise<string> {
  if (input.session.multipartUploadId) {
    return input.session.multipartUploadId;
  }
  const handle = await input.storage.createMultipartUpload({
    bucket: input.storage.quarantineBucket,
    key: input.objectKey,
    contentType: input.contentType,
    abortSignal: input.signal,
  });
  try {
    await attachMultipartUploadId({
      uploadSessionId: input.session.id,
      multipartUploadId: handle.uploadId,
    });
  } catch (error) {
    await input.storage.abortMultipartUpload({
      bucket: input.storage.quarantineBucket,
      key: input.objectKey,
      uploadId: handle.uploadId,
      abortSignal: AbortSignal.timeout(30_000),
    });
    throw error;
  }
  return handle.uploadId;
}

export async function storeResumablePart(input: {
  session: UploadSessionRecord;
  storage: S3StorageAdapter;
  objectKey: string;
  partNumber: number;
  payload: Uint8Array;
  signal: AbortSignal;
}): Promise<ResumablePartResult> {
  const uploadId = await ensureMultipartUpload({
    session: input.session,
    storage: input.storage,
    objectKey: input.objectKey,
    contentType: input.session.declaredContentType ?? undefined,
    signal: input.signal,
  });
  const hashed = hashBuffer(input.payload);
  const uploaded = await input.storage.uploadPart({
    bucket: input.storage.quarantineBucket,
    key: input.objectKey,
    uploadId,
    partNumber: input.partNumber,
    body: input.payload,
    contentLength: input.payload.byteLength,
    abortSignal: input.signal,
  });
  await recordUploadPart({
    uploadSessionId: input.session.id,
    partNumber: input.partNumber,
    sizeBytes: hashed.sizeBytes,
    etag: uploaded.etag,
    checksumSha256: hashed.sha256,
  });
  return {
    etag: uploaded.etag,
    checksumSha256: hashed.sha256.toString('base64url'),
    sizeBytes: hashed.sizeBytes,
  };
}

function assertContiguousParts(parts: UploadPartRecord[]): void {
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part || part.partNumber !== index + 1) {
      throw new Error('UPLOAD_PART_SEQUENCE_INVALID');
    }
  }
}

function assertMultipartPartSizes(parts: UploadPartRecord[]): void {
  if (parts.length <= 1) {
    return;
  }
  const lastPartNumber = parts.length;
  for (const part of parts) {
    if (part.partNumber !== lastPartNumber && part.sizeBytes < 5 * 1024 * 1024) {
      throw new Error('UPLOAD_PART_TOO_SMALL');
    }
  }
}

export async function sealResumableUpload(input: {
  file: FileRecord;
  session: UploadSessionRecord;
  storage: S3StorageAdapter;
  signal: AbortSignal;
}): Promise<SealedUploadResult> {
  if (!input.session.multipartUploadId) {
    throw new Error('UPLOAD_MULTIPART_MISSING');
  }
  const parts = await db
    .select()
    .from(uploadParts)
    .where(eq(uploadParts.uploadSessionId, input.session.id))
    .orderBy(uploadParts.partNumber)
    .limit(10_001);
  if (parts.length === 0) {
    throw new Error('UPLOAD_PARTS_MISSING');
  }
  if (parts.length > 10_000) throw new Error('UPLOAD_PART_SEQUENCE_INVALID');
  let total = 0;
  for (const part of parts) total += part.sizeBytes;
  if (total !== input.session.declaredSizeBytes) throw new Error('UPLOAD_SIZE_MISMATCH');
  assertContiguousParts(parts);
  assertMultipartPartSizes(parts);

  await markUploadSessionStatus({
    uploadSessionId: input.session.id,
    status: 'completing',
  });

  const signal = input.signal;
  const location = { bucket: input.storage.quarantineBucket, key: input.file.objectKey };
  let etag: string | undefined;
  if (input.session.status === 'completing') {
    try {
      etag = (await input.storage.headObject({ ...location, abortSignal: signal })).etag;
    } catch (error) {
      if (!(error instanceof Error) || !isObjectNotFound(error)) throw error;
    }
  }
  etag ??= (
    await input.storage.completeMultipartUpload({
      ...location,
      uploadId: input.session.multipartUploadId,
      parts: parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
      abortSignal: signal,
    })
  ).etag;
  const sealed = await input.storage.getObject({
    ...location,
    expectedEtag: etag,
    abortSignal: signal,
  });
  const hashed = await hashByteStream(sealed.body, input.session.declaredSizeBytes ?? 0);
  if (hashed.sizeBytes !== input.session.declaredSizeBytes) throw new Error('UPLOAD_SIZE_MISMATCH');
  const next = await completeAndEnqueueScan({
    fileId: input.file.id,
    expectedRowVersion: input.file.rowVersion,
    checksumSha256: hashed.sha256,
    sizeBytes: hashed.sizeBytes,
    etag,
    sealedEtag: etag,
    detectedContentType: null,
  });
  return {
    status: next.status,
    rowVersion: next.rowVersion,
    sizeBytes: hashed.sizeBytes,
    checksumSha256: hashed.sha256.toString('base64url'),
    etag,
  };
}

export async function abortResumableUpload(input: {
  session: UploadSessionRecord;
  storage: S3StorageAdapter | null;
  objectKey: string;
  signal: AbortSignal;
}): Promise<void> {
  if (input.storage && input.session.multipartUploadId) {
    await input.storage.abortMultipartUpload({
      bucket: input.storage.quarantineBucket,
      key: input.objectKey,
      uploadId: input.session.multipartUploadId,
      abortSignal: input.signal,
    });
  }
}

export type { UploadPartRecord, UploadSessionRecord };

export { abortFile, completeAndEnqueueScan, markUploading };

export function parsePartNumber(value: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error('UPLOAD_PART_NUMBER_INVALID');
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 10_000)
    throw new Error('UPLOAD_PART_NUMBER_INVALID');
  return number;
}

export function assertUploadPolicy(
  caller: CallerContext,
  size: number | null,
  contentType: string | null,
): asserts size is number {
  if (caller.caller.status !== 'active') throw new Error('CALLER_NOT_ACTIVE');
  if (size === null || !Number.isSafeInteger(size) || size < 0)
    throw new Error('UPLOAD_SIZE_MISMATCH');
  if (
    size > caller.caller.maxFileSizeBytes ||
    (caller.credential?.maxFileSizeBytes != null && size > caller.credential.maxFileSizeBytes)
  )
    throw new Error('QUOTA_EXCEEDED');
  for (const types of [caller.caller.allowedContentTypes, caller.credential?.allowedTypes ?? []]) {
    if (types.length && (!contentType || !types.includes(contentType)))
      throw new Error('UPLOAD_TYPE_NOT_ALLOWED');
  }
}

export function assertUploadOpen(
  file: Pick<FileRecord, 'status'>,
  session: Pick<UploadSessionRecord, 'mode' | 'status' | 'expiresAt'>,
  mode: UploadMode,
  completing = false,
): void {
  if (session.mode !== mode) throw new Error('UPLOAD_MODE_INVALID');
  if (
    session.expiresAt <= new Date() ||
    (session.status !== 'initiated' &&
      session.status !== 'uploading' &&
      !(completing && session.status === 'completing'))
  )
    throw new Error('UPLOAD_SESSION_INVALID');
  if (file.status !== 'initiated' && file.status !== 'uploading')
    throw new Error('FILE_TRANSITION_INVALID');
}

export function assertUploadHeaders(
  headers: Headers,
  size: number,
  contentType: string | null,
): void {
  const length = headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/.test(length) || Number(length) !== size))
    throw new Error('UPLOAD_SIZE_MISMATCH');
  if (headers.get('content-type') !== contentType) throw new Error('UPLOAD_TYPE_NOT_ALLOWED');
}

export async function loadPreviousPartSize(sessionId: string, partNumber: number): Promise<number> {
  const [part] = await db
    .select({ sizeBytes: uploadParts.sizeBytes })
    .from(uploadParts)
    .where(and(eq(uploadParts.uploadSessionId, sessionId), eq(uploadParts.partNumber, partNumber)))
    .limit(1);
  return part?.sizeBytes ?? 0;
}

export const createUploadSchema = v.object({
  storageBackendId: v.pipe(v.string(), v.minLength(1)),
  originalFilename: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  declaredContentType: v.optional(v.nullable(v.string())),
  declaredSizeBytes: v.pipe(v.number(), v.safeInteger(), v.minValue(0)),
  idempotencyKey: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(255)))),
  mode: v.picklist(['proxy_single', 'proxy_parts']),
});
