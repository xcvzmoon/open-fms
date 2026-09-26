import { bigint, boolean, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { fmsSchema } from '../schema.ts';
import { bytea } from '../types.ts';
import { callers, storageBackends } from './registration.ts';

export const files = fmsSchema.table(
  'files',
  {
    id: generateUuid('id'),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id),
    storageBackendId: uuid('storage_backend_id')
      .notNull()
      .references(() => storageBackends.id),
    ownerRef: text('owner_ref'),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    declaredContentType: text('declared_content_type'),
    detectedContentType: text('detected_content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    checksumSha256: bytea('checksum_sha256'),
    etag: text('etag'),
    sealedEtag: text('sealed_etag'),
    status: text('status', {
      enum: [
        'initiated',
        'uploading',
        'uploaded',
        'quarantined',
        'scanning',
        'clean',
        'infected',
        'rejected',
        'failed',
        'deleted',
      ],
    })
      .notNull()
      .default('initiated'),
    statusReason: text('status_reason'),
    scanPolicyVersion: text('scan_policy_version'),
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata').notNull().default({}),
    legalHold: boolean('legal_hold').notNull().default(false),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    ...generateTimestamps(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (table) => [
    index('files_caller_status_idx').on(table.callerId, table.status),
    index('files_status_purge_after_idx').on(table.status, table.purgeAfter),
    index('files_storage_backend_id_idx').on(table.storageBackendId),
    index('files_object_key_idx').on(table.objectKey),
  ],
);
