import { describe, expect, test } from 'vite-plus/test';
import { createStorageAdapter, S3StorageAdapter } from '../src/index.ts';

const config = {
  id: 'backend-1',
  name: 'rustfs-local',
  kind: 'rustfs' as const,
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  quarantineBucket: 'fms-quarantine',
  cleanBucket: 'fms-clean',
  forensicBucket: 'fms-forensic',
  credentialRef: 'env:default',
  forcePathStyle: true,
};

const credentials = {
  accessKeyId: 'test-access',
  secretAccessKey: 'test-secret',
};

describe('S3StorageAdapter', () => {
  test('exposes backend identity and bucket names', () => {
    const adapter = createStorageAdapter({ config, credentials });
    expect(adapter).toBeInstanceOf(S3StorageAdapter);
    expect(adapter.backendId).toBe('backend-1');
    expect(adapter.quarantineBucket).toBe('fms-quarantine');
    expect(adapter.cleanBucket).toBe('fms-clean');
    expect(adapter.forensicBucket).toBe('fms-forensic');
    adapter.destroy();
  });

  test('presigns put with method and content type header', async () => {
    const adapter = createStorageAdapter({ config, credentials });
    const result = await adapter.presignPut({
      location: { bucket: 'fms-quarantine', key: 'incoming/file' },
      expiresIn: 900,
      contentType: 'application/octet-stream',
    });
    expect(result.method).toBe('PUT');
    expect(result.url).toContain('X-Amz-Signature');
    expect(result.url).toContain('/fms-quarantine/incoming/file');
    expect(result.headers['content-type']).toBe('application/octet-stream');
    adapter.destroy();
  });
});
