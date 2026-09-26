import { bigint, index, integer, jsonb, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers/index.ts';
import { fmsSchema } from '../schema.ts';
import { callers } from './registration.ts';

export const callerUsage = fmsSchema.table(
  'caller_usage',
  {
    callerId: uuid('caller_id')
      .primaryKey()
      .references(() => callers.id, { onDelete: 'cascade' }),
    bytesReserved: bigint('bytes_reserved', { mode: 'number' }).notNull().default(0),
    bytesUsed: bigint('bytes_used', { mode: 'number' }).notNull().default(0),
    fileCount: bigint('file_count', { mode: 'number' }).notNull().default(0),
    rowVersion: integer('row_version').notNull().default(1),
    ...generateTimestamps(),
  },
  (table) => [index('caller_usage_bytes_used_idx').on(table.bytesUsed)],
);

/**
 * Append-only audit trail. Rows are never updated or soft-deleted.
 */
export const auditEvents = fmsSchema.table(
  'audit_events',
  {
    id: generateUuid('id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorType: text('actor_type', {
      enum: ['caller', 'admin', 'system', 'worker'],
    }).notNull(),
    actorId: uuid('actor_id'),
    actorKeyId: text('actor_key_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    callerId: uuid('caller_id'),
    requestId: text('request_id'),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    outcome: text('outcome', { enum: ['success', 'failure', 'denied'] }).notNull(),
    reason: text('reason'),
    metadata: jsonb('metadata').notNull().default({}),
  },
  (table) => [
    index('audit_events_occurred_at_idx').on(table.occurredAt),
    index('audit_events_actor_idx').on(table.actorType, table.actorId, table.occurredAt),
    index('audit_events_target_idx').on(table.targetType, table.targetId),
    index('audit_events_caller_occurred_at_idx').on(table.callerId, table.occurredAt),
    index('audit_events_action_idx').on(table.action),
  ],
);
