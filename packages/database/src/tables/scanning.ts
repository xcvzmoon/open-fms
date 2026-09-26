import { bigint, index, integer, jsonb, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { fmsSchema } from '../schema.ts';
import { bytea } from '../types.ts';
import { files } from './files.ts';

export const scanJobs = fmsSchema.table(
  'scan_jobs',
  {
    id: generateUuid('id'),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['pending', 'claimed', 'running', 'succeeded', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    priority: integer('priority').notNull().default(0),
    attemptCount: integer('attempt_count').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    scanPolicyVersion: text('scan_policy_version'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    claimedBy: text('claimed_by'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    availableAt: timestamp('available_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    lastError: text('last_error'),
    rowVersion: integer('row_version').notNull().default(1),
    ...generateTimestamps(),
  },
  (table) => [
    index('scan_jobs_status_available_at_idx').on(table.status, table.availableAt),
    index('scan_jobs_file_id_idx').on(table.fileId),
    index('scan_jobs_lease_expires_at_idx').on(table.leaseExpiresAt),
  ],
);

export const scanResults = fmsSchema.table(
  'scan_results',
  {
    id: generateUuid('id'),
    scanJobId: uuid('scan_job_id')
      .notNull()
      .references(() => scanJobs.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    verdict: text('verdict', { enum: ['clean', 'infected', 'rejected', 'failed'] }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    checksumSha256: bytea('checksum_sha256'),
    detectedContentType: text('detected_content_type'),
    scanPolicyVersion: text('scan_policy_version'),
    engine: text('engine').notNull(),
    engineVersion: text('engine_version'),
    signaturesUpdatedAt: timestamp('signatures_updated_at', { withTimezone: true }),
    details: jsonb('details').notNull().default({}),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull().defaultNow(),
    ...generateTimestamps(),
  },
  (table) => [
    unique('scan_results_scan_job_id_uq').on(table.scanJobId),
    index('scan_results_file_id_idx').on(table.fileId),
    index('scan_results_verdict_scanned_at_idx').on(table.verdict, table.scannedAt),
  ],
);
