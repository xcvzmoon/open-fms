import { eq } from 'drizzle-orm';
import { db } from '../client.ts';
import { storageBackends } from '../tables/index.ts';

export type StorageBackendRecord = {
  id: string;
  name: string;
  kind: 'rustfs' | 'minio' | 's3';
  endpoint: string;
  region: string;
  quarantineBucket: string;
  cleanBucket: string;
  forensicBucket: string | null;
  credentialRef: string;
  isDefault: boolean;
  status: 'active' | 'read_only' | 'disabled';
};

export async function loadStorageBackend(id: string): Promise<StorageBackendRecord | null> {
  const rows = await db.select().from(storageBackends).where(eq(storageBackends.id, id)).limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    endpoint: row.endpoint,
    region: row.region,
    quarantineBucket: row.quarantineBucket,
    cleanBucket: row.cleanBucket,
    forensicBucket: row.forensicBucket,
    credentialRef: row.credentialRef,
    isDefault: row.isDefault,
    status: row.status,
  };
}

export async function loadDefaultStorageBackend(): Promise<StorageBackendRecord | null> {
  const rows = await db
    .select()
    .from(storageBackends)
    .where(eq(storageBackends.isDefault, true))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    endpoint: row.endpoint,
    region: row.region,
    quarantineBucket: row.quarantineBucket,
    cleanBucket: row.cleanBucket,
    forensicBucket: row.forensicBucket,
    credentialRef: row.credentialRef,
    isDefault: row.isDefault,
    status: row.status,
  };
}
