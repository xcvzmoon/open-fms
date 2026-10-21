import {
  listStaleUploadFiles,
  purgeExpiredSetupCodes,
  reclaimScanLeases,
  loadUploadSessionByFileId,
} from '@open-fms/database';
import { abortFile, retireFailedScans } from '@open-fms/lifecycle';
import { defineTask } from 'nitro/task';
import { resolveUploadCredentials } from '../uploads/credentials.ts';
import { withUploadLock } from '../uploads/lock.ts';
import { resolveStorageAdapter } from '../uploads/service.ts';

export default defineTask({
  meta: {
    name: 'sweep-expired',
    description: 'Expire pending registration and uploads and recover scan leases',
  },
  async run() {
    const setupCodes = await purgeExpiredSetupCodes();
    const scanLeases = await reclaimScanLeases();
    const failedScans = await retireFailedScans();
    let expired = 0;
    let failed = 0;
    for (const file of await listStaleUploadFiles()) {
      try {
        await withUploadLock(file.id, file.callerId, async () => {
          const session = await loadUploadSessionByFileId(file.id);
          if (session?.multipartUploadId) {
            const storage = await resolveStorageAdapter(
              file.storageBackendId,
              resolveUploadCredentials(),
            );
            try {
              await storage.abortMultipartUpload({
                bucket: storage.quarantineBucket,
                key: file.objectKey,
                uploadId: session.multipartUploadId,
              });
            } finally {
              storage.destroy();
            }
          }
          await abortFile({
            fileId: file.id,
            expectedStatus: file.status,
            expectedRowVersion: file.rowVersion,
            reason: 'upload_expired',
          });
        });
        expired += 1;
      } catch {
        failed += 1;
      }
    }
    return { result: { setupCodes, scanLeases, failedScans, expired, failed } };
  },
});
