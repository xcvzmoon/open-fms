import { sql } from 'drizzle-orm';
import { db } from '../client.ts';

export async function pingDatabase(): Promise<void> {
  await db.execute(sql`SELECT 1`);
}
