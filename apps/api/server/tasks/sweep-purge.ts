import { listPurgeableFiles, loadUploadSessionByFileId } from '@open-fms/database';
import { purgeFile } from '@open-fms/lifecycle';
import { defineTask } from 'nitro/task';
import { resolveUploadCredentials } from '../uploads/credentials.ts';
import { resolveStorageAdapter } from '../uploads/service.ts';

export default defineTask({
  meta: {
    name: 'sweep-purge',
    description: 'Tombstone due files, remove storage copies and release accounted quota',
  },
  async run() {
    let purged = 0;
    let failed = 0;
    for (const file of await listPurgeableFiles()) {
      try {
        const storage = await resolveStorageAdapter(
          file.storageBackendId,
          resolveUploadCredentials(),
        );
        try {
          const session = await loadUploadSessionByFileId(file.id);
          if (session?.multipartUploadId)
            await storage.abortMultipartUpload({
              bucket: storage.quarantineBucket,
              key: file.objectKey,
              uploadId: session.multipartUploadId,
            });
          await purgeFile({
            fileId: file.id,
            expectedStatus: file.status,
            expectedRowVersion: file.rowVersion,
            storage,
            cleanBucket: storage.cleanBucket,
            quarantineBucket: storage.quarantineBucket,
            forensicBucket: storage.forensicBucket,
          });
          purged += 1;
        } finally {
          storage.destroy();
        }
      } catch {
        failed += 1;
      }
    }
    return { result: { purged, failed } };
  },
});
