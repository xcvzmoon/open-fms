import { loadDefaultStorageBackend } from '@open-fms/database';
import { createStorageAdapter } from '@open-fms/storage';
import { defineTask } from 'nitro/task';
import { runStorageCanary } from '~/server/observability/canary.ts';

export default defineTask({
  meta: {
    name: 'observability-canary',
    description: 'Run process canary and optional storage HEAD canary',
  },
  async run() {
    const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY;
    const result = await runStorageCanary({
      enabled: Boolean(accessKeyId && secretAccessKey),
      head:
        accessKeyId && secretAccessKey
          ? async () => {
              const backend = await loadDefaultStorageBackend();
              if (!backend) {
                throw new Error('STORAGE_BACKEND_MISSING');
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
                credentials: {
                  accessKeyId,
                  secretAccessKey,
                  sessionToken: process.env.STORAGE_SESSION_TOKEN,
                },
              });
              try {
                await storage.headObject({
                  bucket: backend.cleanBucket,
                  key: 'healthz-canary',
                });
              } catch (error) {
                const message = error instanceof Error ? error.message : 'head_failed';
                if (!message.includes('NotFound') && !message.includes('404')) {
                  throw error;
                }
              } finally {
                storage.destroy();
              }
            }
          : undefined,
    });
    return { result };
  },
});
