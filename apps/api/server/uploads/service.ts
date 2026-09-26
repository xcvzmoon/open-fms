import { loadFileForCaller, loadStorageBackend, type FileRecord } from '@open-fms/database';
import {
  abortFile,
  completeAndEnqueueScan,
  createFileWithUploadSession,
  LifecycleError,
  markUploading,
  type CreatedFile,
} from '@open-fms/lifecycle';
import { createStorageAdapter, type S3StorageAdapter } from '@open-fms/storage';
import { randomUUID } from 'node:crypto';

export type CreateUploadInput = {
  callerId: string;
  storageBackendId: string;
  originalFilename: string;
  declaredContentType: string | null;
  declaredSizeBytes: number | null;
  idempotencyKey?: string | null;
  mode: 'proxy_single' | 'proxy_parts' | 'direct';
};

export type UploadCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
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

export { abortFile, completeAndEnqueueScan, markUploading };
