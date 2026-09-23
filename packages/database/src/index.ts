import { drizzle } from 'drizzle-orm/postgres-js';
import { EnhancedQueryLogger } from 'drizzle-query-logger';
import postgres from 'postgres';
import { env } from './env.ts';
import { relations } from './relations.ts';

export * from './schema.ts';

export const db = drizzle({
  client: postgres(env.db.url),
  logger: new EnhancedQueryLogger(),
  relations,
});
