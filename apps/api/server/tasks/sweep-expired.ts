import {
  expireSetupCodes,
  expireUploadPasses,
  expireUploadSessions,
  listStaleUploadFiles,
  reclaimScanLeases,
} from '@open-fms/database';
import { expireStaleUpload } from '@open-fms/lifecycle';
import { defineTask } from 'nitro/task';

export default defineTask({
  meta: {
    name: 'sweep:expired',
    description: 'Expire setup codes, upload passes, upload sessions, and stale uploads',
  },
  async run() {
    const setupCodes = await expireSetupCodes();
    const uploadPasses = await expireUploadPasses();
    const uploadSessions = await expireUploadSessions();
    const scanLeases = await reclaimScanLeases();

    const stale = await listStaleUploadFiles();
    const results = await Promise.allSettled(
      stale.map((file) =>
        expireStaleUpload({
          fileId: file.id,
          expectedStatus: file.status,
          expectedRowVersion: file.rowVersion,
          reservedBytes: file.sizeBytes ?? 0,
          reason: 'upload_expired',
        }),
      ),
    );
    let staleUploads = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        staleUploads += 1;
      }
    }

    return {
      result: {
        setupCodes,
        uploadPasses,
        uploadSessions,
        scanLeases,
        staleUploads,
      },
    };
  },
});
