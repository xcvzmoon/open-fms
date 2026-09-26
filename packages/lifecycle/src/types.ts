export type LifecycleStorage = {
  copyObject(input: {
    sourceBucket: string;
    sourceKey: string;
    destinationBucket: string;
    destinationKey: string;
  }): Promise<{ etag: string }>;
  headObject(location: {
    bucket: string;
    key: string;
  }): Promise<{ etag: string; contentLength: number }>;
  deleteObject(location: { bucket: string; key: string }): Promise<void>;
};

export type QuotaSnapshot = {
  bytesReserved: number;
  bytesUsed: number;
  fileCount: number;
};

export type LifecycleErrorCode =
  | 'FILE_NOT_FOUND'
  | 'FILE_TRANSITION_INVALID'
  | 'FILE_ROW_VERSION_CONFLICT'
  | 'FILE_NOT_DOWNLOADABLE'
  | 'QUOTA_EXCEEDED'
  | 'STORAGE_SEAL_MISMATCH'
  | 'STORAGE_PROMOTE_MISMATCH'
  | 'LIFECYCLE_FAILED';

export type LifecycleFailure = {
  code: LifecycleErrorCode;
};

export class LifecycleError extends Error {
  readonly code: LifecycleErrorCode;

  constructor(code: LifecycleErrorCode) {
    super(code);
    this.name = 'LifecycleError';
    this.code = code;
  }
}

export function toLifecycleFailure(error: Error): LifecycleFailure {
  if (error instanceof LifecycleError) {
    return { code: error.code };
  }
  return { code: 'LIFECYCLE_FAILED' };
}
