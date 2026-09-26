import { pgSchema } from 'drizzle-orm/pg-core';

/**
 * Named PostgreSQL schema for every Open FMS table.
 *
 * Tables, migrations, and raw SQL must stay inside `fms` and never use `public`.
 *
 * @example
 * ```ts
 * export const files = fmsSchema.table('files', {
 *   id: generateUuid('id'),
 * });
 * ```
 */
export const fmsSchema = pgSchema('fms');
