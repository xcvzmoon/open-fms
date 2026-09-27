import { bigint, index, integer, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { fmsSchema } from '../schema.ts';
import { bytea } from '../types.ts';
import { files } from './files.ts';
import { callers } from './registration.ts';

export const uploadSessions = fmsSchema.table(
  'upload_sessions',
  {
    id: generateUuid('id'),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id),
    mode: text('mode', { enum: ['proxy_single', 'proxy_parts', 'direct'] })
      .notNull()
      .default('proxy_single'),
    status: text('status', {
      enum: ['initiated', 'uploading', 'completing', 'completed', 'aborted', 'expired'],
    })
      .notNull()
      .default('initiated'),
    multipartUploadId: text('multipart_upload_id'),
    declaredSizeBytes: bigint('declared_size_bytes', { mode: 'number' }),
    receivedSizeBytes: bigint('received_size_bytes', { mode: 'number' }).notNull().default(0),
    partSizeBytes: integer('part_size_bytes').notNull().default(16_777_216),
    partCount: integer('part_count').notNull().default(0),
    declaredContentType: text('declared_content_type'),
    createIdempotencyKey: text('create_idempotency_key'),
    completeIdempotencyKey: text('complete_idempotency_key'),
    abortIdempotencyKey: text('abort_idempotency_key'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    abortedAt: timestamp('aborted_at', { withTimezone: true }),
    abortReason: text('abort_reason'),
    rowVersion: integer('row_version').notNull().default(1),
    ...generateTimestamps(),
  },
  (table) => [
    unique('upload_sessions_file_id_uq').on(table.fileId),
    index('upload_sessions_caller_status_idx').on(table.callerId, table.status),
    index('upload_sessions_status_expires_at_idx').on(table.status, table.expiresAt),
  ],
);

export const uploadParts = fmsSchema.table(
  'upload_parts',
  {
    id: generateUuid('id'),
    uploadSessionId: uuid('upload_session_id')
      .notNull()
      .references(() => uploadSessions.id, { onDelete: 'cascade' }),
    partNumber: integer('part_number').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    etag: text('etag').notNull(),
    checksumSha256: bytea('checksum_sha256'),
    ...generateTimestamps(),
  },
  (table) => [
    unique('upload_parts_session_part_uq').on(table.uploadSessionId, table.partNumber),
    index('upload_parts_session_idx').on(table.uploadSessionId),
  ],
);
