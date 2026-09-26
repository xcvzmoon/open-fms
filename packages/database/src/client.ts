import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from './env.ts';

const client = postgres(env.db.url, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

/**
 * Shared Drizzle handle for Open FMS API, workers, and sweepers.
 */
export const db = drizzle({ client });

/**
 * Inferred database type for typed helpers and transaction callbacks.
 */
export type Database = typeof db;

/**
 * Ends the postgres.js pool. Call this from process shutdown handlers.
 */
export async function closeDatabase(): Promise<void> {
  await client.end({ timeout: 5 });
}
