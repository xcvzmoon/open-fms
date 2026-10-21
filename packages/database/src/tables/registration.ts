import { bigint, boolean, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from '../auth/schema.ts';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { fmsSchema } from '../schema.ts';
import { bytea } from '../types.ts';

export const storageBackends = fmsSchema.table(
  'storage_backends',
  {
    id: generateUuid('id'),
    name: text('name').notNull().unique(),
    kind: text('kind', { enum: ['rustfs', 'minio', 's3'] }).notNull(),
    endpoint: text('endpoint').notNull(),
    region: text('region').notNull().default('us-east-1'),
    quarantineBucket: text('quarantine_bucket').notNull(),
    cleanBucket: text('clean_bucket').notNull(),
    forensicBucket: text('forensic_bucket'),
    credentialRef: text('credential_ref').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status', { enum: ['active', 'read_only', 'disabled'] })
      .notNull()
      .default('active'),
    ...generateTimestamps(),
  },
  (table) => [index('storage_backends_status_idx').on(table.status)],
);

export const callers = fmsSchema.table(
  'callers',
  {
    id: generateUuid('id'),
    ownerUserId: text('owner_user_id')
      .notNull()
      .unique()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rateWindowStart: timestamp('rate_window_start', { withTimezone: true }),
    rateWindowCount: integer('rate_window_count').notNull().default(0),
    name: text('name').notNull().unique(),
    kind: text('kind', { enum: ['app', 'admin'] })
      .notNull()
      .default('app'),
    status: text('status', {
      enum: ['pending_verification', 'active', 'suspended', 'disabled'],
    })
      .notNull()
      .default('active'),
    signupSource: text('signup_source', { enum: ['admin', 'self_signup'] })
      .notNull()
      .default('admin'),
    ownerEmail: text('owner_email'),
    ownerVerifiedAt: timestamp('owner_verified_at', { withTimezone: true }),
    maxFileSizeBytes: bigint('max_file_size_bytes', { mode: 'number' })
      .notNull()
      .default(1_073_741_824),
    allowedContentTypes: text('allowed_content_types').array().notNull().default([]),
    quotaBytes: bigint('quota_bytes', { mode: 'number' }),
    rateLimitPerSec: integer('rate_limit_per_sec'),
    retentionDays: integer('retention_days'),
    ...generateTimestamps(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by'),
    deletedBy: text('deleted_by'),
  },
  (table) => [index('callers_status_idx').on(table.status)],
);

export const callerCredentials = fmsSchema.table(
  'caller_credentials',
  {
    id: generateUuid('id'),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['standard', 'restricted'] })
      .notNull()
      .default('standard'),
    keyPrefix: text('key_prefix').notNull(),
    keyId: text('key_id').notNull().unique(),
    scopes: text('scopes').array().notNull().default([]),
    allowedCidrs: text('allowed_cidrs').array().notNull().default([]),
    allowedTypes: text('allowed_types').array().notNull().default([]),
    maxFileSizeBytes: bigint('max_file_size_bytes', { mode: 'number' }),
    rateLimitPerSec: integer('rate_limit_per_sec'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    ...generateTimestamps(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by'),
    deletedBy: text('deleted_by'),
  },
  (table) => [index('caller_credentials_caller_id_idx').on(table.callerId)],
);

export const setupCodes = fmsSchema.table(
  'setup_codes',
  {
    id: generateUuid('id'),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id, { onDelete: 'cascade' }),
    codeHash: bytea('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    ...generateTimestamps(),
  },
  (table) => [
    index('setup_codes_caller_id_idx').on(table.callerId),
    index('setup_codes_hash_idx').on(table.codeHash),
  ],
);

export const serviceSettings = fmsSchema.table('service_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
