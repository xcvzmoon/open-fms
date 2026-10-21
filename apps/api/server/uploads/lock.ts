import { db } from '@open-fms/database';
import { sql } from 'drizzle-orm';
import * as v from 'valibot';
import { withUploadCapacity } from './body.ts';

const lockSchema = v.object({ locked: v.boolean() });
export async function withUploadLock<T>(
  fileId: string,
  callerId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withUploadCapacity(callerId, () =>
    db.transaction(async (tx) => {
      const rows = await tx.execute(
        sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${fileId}, 0)) AS locked`,
      );
      const result = v.parse(lockSchema, rows[0]);
      if (!result.locked) throw new Error('UPLOAD_BUSY');
      return operation();
    }),
  );
}
