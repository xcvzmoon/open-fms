import { loadFileById, loadStorageBackend, type FileRecord } from '@open-fms/database';
import { LifecycleError } from '@open-fms/lifecycle';
import {
  closeBody,
  createStorageAdapter,
  isInvalidObjectRange,
  type S3StorageAdapter,
} from '@open-fms/storage';
import { DownloadRangeError, validateDownloadRange } from './headers.ts';

export type DownloadRequest = {
  fileId: string;
  callerId: string;
  abortSignal?: AbortSignal | undefined;
  rangeHeader?: string | undefined;
};

export type DownloadPayload = {
  file: FileRecord;
  storage: S3StorageAdapter;
  body: ReadableStream;
  etag: string;
  contentLength: number | undefined;
  contentRange: string | undefined;
  contentType: string | undefined;
  filename: string;
};

export type DownloadCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
};

export async function openDownload(
  input: DownloadRequest,
  credentials: DownloadCredentials,
): Promise<DownloadPayload> {
  const range = validateDownloadRange(input.rangeHeader);

  const file = await loadFileById(input.fileId);
  if (!file || file.callerId !== input.callerId) {
    throw new LifecycleError('FILE_NOT_FOUND');
  }

  if (file.status !== 'clean') {
    throw new LifecycleError('FILE_NOT_DOWNLOADABLE');
  }

  const backend = await loadStorageBackend(file.storageBackendId);
  if (!backend) {
    throw new LifecycleError('FILE_NOT_FOUND');
  }

  const storage = createStorageAdapter({
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

  try {
    const object = await storage.getObject({
      bucket: backend.cleanBucket,
      key: file.objectKey,
      range,
      abortSignal: input.abortSignal,
    });

    return {
      file,
      storage,
      body: closeBody(object.body, () => {
        storage.destroy();
      }),
      etag: object.etag,
      contentLength: object.contentLength,
      contentRange: object.contentRange,
      contentType: file.detectedContentType ?? 'application/octet-stream',
      filename: file.originalFilename,
    };
  } catch (error) {
    storage.destroy();
    if (error instanceof Error && isInvalidObjectRange(error)) throw new DownloadRangeError();
    throw error;
  }
}
