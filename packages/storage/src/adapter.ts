import type {
  CopyObjectResult,
  HeadObjectResult,
  MultipartUploadHandle,
  PresignPutInput,
  PresignPutResult,
  PutObjectInput,
  PutObjectResult,
  StorageBackendConfig,
  StorageCredentials,
  UploadPartResult,
} from './types.ts';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';

export type StorageAdapterOptions = {
  config: StorageBackendConfig;
  credentials: StorageCredentials;
};

function encodeCopySegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildClientConfig(options: StorageAdapterOptions): S3ClientConfig {
  return {
    requestHandler: {
      connectionTimeout: 5_000,
      socketTimeout: 30_000,
      requestTimeout: 60_000,
      throwOnRequestTimeout: true,
    },
    maxAttempts: 2,
    region: options.config.region,
    endpoint: options.config.endpoint,
    forcePathStyle: options.config.forcePathStyle,
    credentials: {
      accessKeyId: options.credentials.accessKeyId,
      secretAccessKey: options.credentials.secretAccessKey,
      sessionToken: options.credentials.sessionToken,
    },
  };
}

/**
 * Single S3-compatible adapter for RustFS, MinIO, and AWS S3.
 * No other module should import `@aws-sdk/*`.
 */
export class S3StorageAdapter {
  readonly #client: S3Client;
  readonly #config: StorageBackendConfig;

  constructor(options: StorageAdapterOptions) {
    this.#config = options.config;
    this.#client = new S3Client(buildClientConfig(options));
  }

  get backendId(): string {
    return this.#config.id;
  }

  get quarantineBucket(): string {
    return this.#config.quarantineBucket;
  }

  get cleanBucket(): string {
    return this.#config.cleanBucket;
  }

  get forensicBucket(): string | null {
    return this.#config.forensicBucket;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    input.abortSignal?.throwIfAborted();
    const multipart = new Upload({
      client: this.#client,
      params: {
        Bucket: input.location.bucket,
        Key: input.location.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
        Metadata: input.metadata,
      },
      queueSize: 2,
      partSize: 8 * 1024 * 1024,
      leavePartsOnError: false,
    });
    function abort(): void {
      if (input.body instanceof Readable) input.body.destroy();
      void multipart.abort().catch(() => {});
    }
    input.abortSignal?.addEventListener('abort', abort, { once: true });
    try {
      input.abortSignal?.throwIfAborted();
      const result = await multipart.done();
      const etag = result.ETag;
      if (!etag) {
        throw new Error('STORAGE_PUT_MISSING_ETAG');
      }
      return { etag: etag.replaceAll('"', '') };
    } finally {
      input.abortSignal?.removeEventListener('abort', abort);
    }
  }

  async getObject(location: {
    bucket: string;
    key: string;
    range?: string | undefined;
    expectedEtag?: string | undefined;
    abortSignal?: AbortSignal | undefined;
  }): Promise<{
    body: ReadableStream;
    etag: string;
    contentLength: number | undefined;
    contentRange: string | undefined;
  }> {
    const result = await this.#client.send(
      new GetObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
        Range: location.range,
        IfMatch: location.expectedEtag,
      }),
      { abortSignal: location.abortSignal },
    );
    const body = result.Body;
    if (!body) {
      throw new Error('STORAGE_GET_MISSING_BODY');
    }
    const etag = result.ETag;
    return {
      body: body.transformToWebStream(),
      etag: etag ? etag.replaceAll('"', '') : '',
      contentLength: result.ContentLength,
      contentRange: result.ContentRange,
    };
  }

  async headObject(location: {
    bucket: string;
    key: string;
    abortSignal?: AbortSignal | undefined;
  }): Promise<HeadObjectResult> {
    const result = await this.#client.send(
      new HeadObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
      }),
      { abortSignal: location.abortSignal },
    );
    const etag = result.ETag;
    return {
      contentLength: result.ContentLength ?? 0,
      etag: etag ? etag.replaceAll('"', '') : '',
      contentType: result.ContentType,
      lastModified: result.LastModified,
    };
  }

  async copyObject(input: {
    abortSignal?: AbortSignal | undefined;
    sourceBucket: string;
    sourceKey: string;
    destinationBucket: string;
    destinationKey: string;
    sourceEtag?: string | undefined;
  }): Promise<CopyObjectResult> {
    const result = await this.#client.send(
      new CopyObjectCommand({
        Bucket: input.destinationBucket,
        Key: input.destinationKey,
        CopySource: [input.sourceBucket, ...input.sourceKey.split('/')]
          .map(encodeCopySegment)
          .join('/'),
        CopySourceIfMatch: input.sourceEtag,
        MetadataDirective: 'COPY',
      }),
      { abortSignal: input.abortSignal },
    );
    const etag = result.CopyObjectResult?.ETag;
    return {
      etag: etag ? etag.replaceAll('"', '') : '',
      copySourceVersionId: result.CopySourceVersionId,
    };
  }

  async deleteObject(location: {
    bucket: string;
    key: string;
    abortSignal?: AbortSignal | undefined;
  }): Promise<void> {
    await this.#client.send(
      new DeleteObjectCommand({
        Bucket: location.bucket,
        Key: location.key,
      }),
      { abortSignal: location.abortSignal },
    );
  }

  async createMultipartUpload(input: {
    abortSignal?: AbortSignal | undefined;
    bucket: string;
    key: string;
    contentType?: string | undefined;
  }): Promise<MultipartUploadHandle> {
    const result = await this.#client.send(
      new CreateMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        ContentType: input.contentType,
      }),
      { abortSignal: input.abortSignal },
    );
    if (!result.UploadId) {
      throw new Error('STORAGE_MULTIPART_MISSING_ID');
    }
    return { uploadId: result.UploadId };
  }

  async uploadPart(input: {
    bucket: string;
    key: string;
    uploadId: string;
    partNumber: number;
    body: Uint8Array | Readable;
    contentLength?: number | undefined;
    abortSignal?: AbortSignal | undefined;
  }): Promise<UploadPartResult> {
    const result = await this.#client.send(
      new UploadPartCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        PartNumber: input.partNumber,
        Body: input.body,
        ContentLength: input.contentLength,
      }),
      { abortSignal: input.abortSignal },
    );
    const etag = result.ETag;
    if (!etag) {
      throw new Error('STORAGE_PART_MISSING_ETAG');
    }
    return {
      etag: etag.replaceAll('"', ''),
      partNumber: input.partNumber,
    };
  }

  async completeMultipartUpload(input: {
    abortSignal?: AbortSignal | undefined;
    bucket: string;
    key: string;
    uploadId: string;
    parts: { partNumber: number; etag: string }[];
  }): Promise<PutObjectResult> {
    const result = await this.#client.send(
      new CompleteMultipartUploadCommand({
        Bucket: input.bucket,
        Key: input.key,
        UploadId: input.uploadId,
        MultipartUpload: {
          Parts: input.parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
      { abortSignal: input.abortSignal },
    );
    const etag = result.ETag;
    if (!etag) {
      throw new Error('STORAGE_MULTIPART_MISSING_ETAG');
    }
    return { etag: etag.replaceAll('"', '') };
  }

  async abortMultipartUpload(input: {
    abortSignal?: AbortSignal | undefined;
    bucket: string;
    key: string;
    uploadId: string;
  }): Promise<void> {
    try {
      await this.#client.send(
        new AbortMultipartUploadCommand({
          Bucket: input.bucket,
          Key: input.key,
          UploadId: input.uploadId,
        }),
        { abortSignal: input.abortSignal },
      );
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'NoSuchUpload') throw error;
    }
  }

  async presignPut(input: PresignPutInput): Promise<PresignPutResult> {
    const command = new PutObjectCommand({
      Bucket: input.location.bucket,
      Key: input.location.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    });
    const url = await getSignedUrl(this.#client, command, {
      expiresIn: input.expiresIn,
    });
    const headers: Record<string, string> = {};
    if (input.contentType) {
      headers['content-type'] = input.contentType;
    }
    return {
      url,
      method: 'PUT',
      headers,
    };
  }

  destroy(): void {
    this.#client.destroy();
  }
}

export function createStorageAdapter(options: StorageAdapterOptions): S3StorageAdapter {
  return new S3StorageAdapter(options);
}

export function isObjectNotFound(error: Error): boolean {
  return (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === 404 &&
    (error.name === 'NotFound' || error.name === 'NoSuchKey')
  );
}

export function isInvalidObjectRange(error: Error): boolean {
  return error instanceof S3ServiceException && error.$metadata.httpStatusCode === 416;
}
