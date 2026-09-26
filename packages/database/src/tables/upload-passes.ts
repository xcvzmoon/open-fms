import { bigint, index, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { fmsSchema } from '../schema.ts';
import { bytea } from '../types.ts';
import { files } from './files.ts';
import { callers } from './registration.ts';

export const uploadPasses = fmsSchema.table(
  'upload_passes',
  {
    id: generateUuid('id'),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id, { onDelete: 'cascade' }),
    tokenHash: bytea('token_hash').notNull(),
    pepperVersion: bigint('pepper_version', { mode: 'number' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...generateTimestamps(),
  },
  (table) => [
    index('upload_passes_file_id_idx').on(table.fileId),
    index('upload_passes_caller_expires_idx').on(table.callerId, table.expiresAt),
    index('upload_passes_expires_at_idx').on(table.expiresAt),
  ],
);
