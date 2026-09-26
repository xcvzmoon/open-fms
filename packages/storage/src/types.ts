import type { Readable } from 'node:stream';

export type StorageBackendKind = 'rustfs' | 'minio' | 's3';

export type StorageBackendConfig = {
  id: string;
  name: string;
  kind: StorageBackendKind;
  endpoint: string;
  region: string;
  quarantineBucket: string;
  cleanBucket: string;
  forensicBucket: string | null;
  credentialRef: string;
  forcePathStyle: boolean;
};

export type StorageCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | undefined;
};

export type ObjectLocation = {
  bucket: string;
  key: string;
};

export type PutObjectInput = {
  location: ObjectLocation;
  body: Uint8Array | string | Readable;
  contentType?: string | undefined;
  contentLength?: number | undefined;
  metadata?: Record<string, string> | undefined;
};

export type PutObjectResult = {
  etag: string;
};

export type HeadObjectResult = {
  contentLength: number;
  etag: string;
  contentType: string | undefined;
  lastModified: Date | undefined;
};

export type CopyObjectResult = {
  etag: string;
  copySourceVersionId?: string | undefined;
};

export type MultipartUploadHandle = {
  uploadId: string;
};

export type UploadPartResult = {
  etag: string;
  partNumber: number;
};

export type PresignPutInput = {
  location: ObjectLocation;
  expiresIn: number;
  contentType?: string | undefined;
  contentLength?: number | undefined;
};

export type PresignPutResult = {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
};
