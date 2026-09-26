import type { AnyPgColumn, UpdateDeleteAction } from 'drizzle-orm/pg-core';
import { timestamp, uuid } from 'drizzle-orm/pg-core';

export type GenerateTimestampsWithAuditOptions =
  | {
      userId: () => AnyPgColumn;
      createdByOnDelete?: UpdateDeleteAction;
      updatedByOnDelete?: UpdateDeleteAction;
      deletedByOnDelete?: UpdateDeleteAction;
    }
  | { userId?: undefined };

export const TIMESTAMP_CONFIG = {
  mode: 'date',
  precision: 3,
  withTimezone: true,
} as const;

/**
 * Adds `createdAt`, `updatedAt`, and `deletedAt` timestamp columns.
 *
 * @example
 * ```ts
 * export const users = pgTable('users', {
 *   id: generateUuid('id'),
 *   ...generateTimestamps(),
 * });
 * ```
 */
export function generateTimestamps() {
  return {
    createdAt: timestamp('created_at', TIMESTAMP_CONFIG).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', TIMESTAMP_CONFIG)
      .notNull()
      .defaultNow()
      .$onUpdateFn(() => new Date()),
    deletedAt: timestamp('deleted_at', TIMESTAMP_CONFIG),
  };
}

/**
 * Adds timestamp columns for rows that track the user responsible for
 * creation, updates, and soft deletion.
 *
 * Pass `userId` to attach foreign keys to the user table. Without `userId`,
 * the UUID columns are created without references.
 *
 * @example
 * ```ts
 * export const collections = pgTable('collections', {
 *   id: generateUuid('id'),
 *   ...generateTimestampsWithAudit({ userId: () => users.id }),
 * });
 * ```
 *
 * @example
 * ```ts
 * export const importJobs = pgTable('import_jobs', {
 *   id: generateUuid('id'),
 *   ...generateTimestampsWithAudit(),
 * });
 * ```
 *
 * @example
 * ```ts
 * export const dashboards = pgTable('dashboards', {
 *   id: generateUuid('id'),
 *   ...generateTimestampsWithAudit({
 *     userId: () => users.id,
 *     createdByOnDelete: 'cascade',
 *     updatedByOnDelete: 'set null',
 *     deletedByOnDelete: 'set null',
 *   }),
 * });
 * ```
 *
 * @defaultValue
 * `createdBy` uses `onDelete: 'restrict'`. `updatedBy` and `deletedBy` use `onDelete: 'set null'`.
 */
export function generateTimestampsWithAudit(options: GenerateTimestampsWithAuditOptions = {}) {
  if (options.userId) {
    const {
      userId,
      createdByOnDelete = 'restrict',
      updatedByOnDelete = 'set null',
      deletedByOnDelete = 'set null',
    } = options;

    return {
      createdBy: uuid('created_by').notNull().references(userId, { onDelete: createdByOnDelete }),
      updatedBy: uuid('updated_by').references(userId, { onDelete: updatedByOnDelete }),
      deletedBy: uuid('deleted_by').references(userId, { onDelete: deletedByOnDelete }),
      ...generateTimestamps(),
    };
  }

  return {
    createdBy: uuid('created_by').notNull(),
    updatedBy: uuid('updated_by'),
    deletedBy: uuid('deleted_by'),
    ...generateTimestamps(),
  };
}
