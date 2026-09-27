import { loadStorageBackend, reconcileFileObjects } from '@open-fms/database';
import { createStorageAdapter, type S3StorageAdapter } from '@open-fms/storage';
import { defineTask } from 'nitro/task';

function resolveCredentials() {
  const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    return null;
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: process.env.STORAGE_SESSION_TOKEN,
  };
}

export default defineTask({
  meta: {
    name: 'sweep:reconcile',
    description: 'Compare file rows with storage objects and report mismatches',
  },
  async run() {
    const credentials = resolveCredentials();
    if (!credentials) {
      return { result: { checked: 0, mismatches: [], skipped: 'storage_credentials_missing' } };
    }

    const result = await reconcileFileObjects({
      async storageForBackend(backendId: string): Promise<S3StorageAdapter | null> {
        const backend = await loadStorageBackend(backendId);
        if (!backend) {
          return null;
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
      },
    });

    return { result };
  },
});
