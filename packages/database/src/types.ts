import { customType } from 'drizzle-orm/pg-core';

/**
 * PostgreSQL `bytea` column used for hashes and binary digests.
 */
export const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});
