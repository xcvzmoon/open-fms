import type { StorageBackendConfig, StorageCredentials } from '../src/index.ts';
import { CreateBucketCommand, S3Client, type S3ClientConfig } from '@aws-sdk/client-s3';

function isBucketExists(error: Error): boolean {
  return (
    error.name === 'BucketAlreadyOwnedByYou' ||
    error.name === 'BucketAlreadyExists' ||
    error.message.includes('BucketAlreadyOwnedByYou') ||
    error.message.includes('BucketAlreadyExists')
  );
}

function clientConfig(
  config: StorageBackendConfig,
  credentials: StorageCredentials,
): S3ClientConfig {
  return {
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  };
}

export async function ensureTestBuckets(input: {
  config: StorageBackendConfig;
  credentials: StorageCredentials;
}): Promise<void> {
  const client = new S3Client(clientConfig(input.config, input.credentials));
  const buckets = [input.config.quarantineBucket, input.config.cleanBucket];
  if (input.config.forensicBucket) {
    buckets.push(input.config.forensicBucket);
  }
  try {
    await Promise.all(
      buckets.map(async (bucket) => {
        try {
          await client.send(new CreateBucketCommand({ Bucket: bucket }));
        } catch (error) {
          if (!(error instanceof Error) || !isBucketExists(error)) {
            throw error;
          }
        }
      }),
    );
  } finally {
    client.destroy();
  }
}
