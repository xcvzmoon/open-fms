import { uuid as $uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidV7 } from 'uuid';

/**
 * Primary key column that defaults to a v7 UUID generated in code, not by the database.
 *
 * @example
 * ```ts
 * export const users = pgTable('users', {
 *   id: generateUuid('id'),
 *   ...generateTimestamps(),
 * });
 * ```
 */
export function generateUuid(name?: string) {
  return $uuid(name)
    .primaryKey()
    .$defaultFn(() => uuidV7());
}
