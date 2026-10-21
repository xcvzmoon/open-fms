import { and, eq } from 'drizzle-orm';
import { db } from '../client.ts';
import { files } from '../tables/index.ts';

export type FileRecord = typeof files.$inferSelect;

export async function loadFileById(fileId: string): Promise<FileRecord | null> {
  const rows = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  return rows[0] ?? null;
}

export async function loadFileForCaller(
  fileId: string,
  callerId: string,
): Promise<FileRecord | null> {
  const rows = await db
    .select()
    .from(files)
    .where(and(eq(files.id, fileId), eq(files.callerId, callerId)))
    .limit(1);
  return rows[0] ?? null;
}
