import { listPurgeableFiles } from '@open-fms/database';
import { purgeFile } from '@open-fms/lifecycle';
import { defineTask } from 'nitro/task';

export default defineTask({
  meta: {
    name: 'sweep-purge',
    description: 'Soft-delete files past purge_after when legal hold is clear',
  },
  async run() {
    const purgeable = await listPurgeableFiles();
    const results = await Promise.allSettled(
      purgeable.map((file) =>
        purgeFile({
          fileId: file.id,
          expectedStatus: file.status,
          expectedRowVersion: file.rowVersion,
        }),
      ),
    );
    let purged = 0;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        purged += 1;
      }
    }
    return { result: { purged } };
  },
});
