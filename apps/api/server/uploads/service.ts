import {
  attachMultipartUploadId,
  listUploadParts,
  loadFileForCaller,
  loadStorageBackend,
  loadUploadSessionByFileId,
  markUploadSessionStatus,
  recordUploadPart,
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
import { createStorageAdapter, type S3StorageAdapter } from '@open-fms/storage';
import { randomUUID } from 'node:crypto';
import { hashBuffer } from './hash.ts';

export type CreateUploadInput = {
  callerId: string;
  storageBackendId: string;
  originalFilename: string;
  declaredContentType: string | null;
  declaredSizeBytes: number | null;
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
}): Promise<string> {
  if (input.session.multipartUploadId) {
    return input.session.multipartUploadId;
  }
  const handle = await input.storage.createMultipartUpload({
    bucket: input.storage.quarantineBucket,
    key: input.objectKey,
    contentType: input.contentType,
  });
  await attachMultipartUploadId({
    uploadSessionId: input.session.id,
    multipartUploadId: handle.uploadId,
  });
  return handle.uploadId;
}

export async function storeResumablePart(input: {
  session: UploadSessionRecord;
  storage: S3StorageAdapter;
  objectKey: string;
  partNumber: number;
  payload: Uint8Array;
}): Promise<ResumablePartResult> {
  const uploadId = await ensureMultipartUpload({
    session: input.session,
    storage: input.storage,
    objectKey: input.objectKey,
  });
  const hashed = hashBuffer(input.payload);
  const uploaded = await input.storage.uploadPart({
    bucket: input.storage.quarantineBucket,
    key: input.objectKey,
    uploadId,
    partNumber: input.partNumber,
    body: input.payload,
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
}): Promise<SealedUploadResult> {
  if (!input.session.multipartUploadId) {
    throw new Error('UPLOAD_MULTIPART_MISSING');
  }
  const parts = await listUploadParts(input.session.id);
  if (parts.length === 0) {
    throw new Error('UPLOAD_PARTS_MISSING');
  }
  assertContiguousParts(parts);
  assertMultipartPartSizes(parts);

  await markUploadSessionStatus({
    uploadSessionId: input.session.id,
    status: 'completing',
  });

  try {
    const completed = await input.storage.completeMultipartUpload({
      bucket: input.storage.quarantineBucket,
      key: input.file.objectKey,
      uploadId: input.session.multipartUploadId,
      parts: parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
    });

    const sealed = await input.storage.getObject({
      bucket: input.storage.quarantineBucket,
      key: input.file.objectKey,
    });
    const payload = Buffer.from(await new Response(sealed.body).arrayBuffer());
    const hashed = hashBuffer(payload);

    const next = await completeAndEnqueueScan({
      fileId: input.file.id,
      expectedRowVersion: input.file.rowVersion,
      checksumSha256: hashed.sha256,
      sizeBytes: hashed.sizeBytes,
      etag: completed.etag,
      sealedEtag: completed.etag,
      detectedContentType: null,
    });

    await markUploadSessionStatus({
      uploadSessionId: input.session.id,
      status: 'completed',
    });

    return {
      status: next.status,
      rowVersion: next.rowVersion,
      sizeBytes: hashed.sizeBytes,
      checksumSha256: hashed.sha256.toString('base64url'),
      etag: completed.etag,
    };
  } catch (error) {
    await markUploadSessionStatus({
      uploadSessionId: input.session.id,
      status: 'uploading',
    });
    throw error;
  }
}

export async function abortResumableUpload(input: {
  session: UploadSessionRecord;
  storage: S3StorageAdapter | null;
  objectKey: string;
  reason: string;
}): Promise<void> {
  if (input.storage && input.session.multipartUploadId) {
    await input.storage.abortMultipartUpload({
      bucket: input.storage.quarantineBucket,
      key: input.objectKey,
      uploadId: input.session.multipartUploadId,
    });
  }
  await markUploadSessionStatus({
    uploadSessionId: input.session.id,
    status: 'aborted',
    abortReason: input.reason,
  });
}

export type { UploadPartRecord, UploadSessionRecord };

export { abortFile, completeAndEnqueueScan, markUploading };
