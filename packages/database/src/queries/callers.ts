import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../client.ts';
import { callerCredentials, callers } from '../tables/index.ts';

export type CallerRecord = {
  id: string;
  name: string;
  kind: 'app' | 'admin';
  status: 'pending_verification' | 'active' | 'suspended' | 'disabled';
  maxFileSizeBytes: number;
  allowedContentTypes: string[];
  quotaBytes: number | null;
  rateLimitPerSec: number | null;
  allowDirectUpload: boolean;
  allowDirectDownload: boolean;
  retentionDays: number | null;
};

export type CallerCredentialPolicy = {
  keyId: string;
  scopes: string[];
  allowedCidrs: string[];
  allowedTypes: string[];
  maxFileSizeBytes: number | null;
  rateLimitPerSec: number | null;
};

export type CallerContext = {
  caller: CallerRecord;
  credential: CallerCredentialPolicy | null;
};

/**
 * Loads FMS tenant policy. Key material stays in Better Auth; scopes, CIDR,
 * and size limits stay in `caller_credentials`.
 */
export async function loadCallerContext(
  callerId: string,
  keyId?: string,
): Promise<CallerContext | null> {
  const callerRows = await db.select().from(callers).where(eq(callers.id, callerId)).limit(1);
  const callerRow = callerRows[0];
  if (!callerRow) {
    return null;
  }

  const caller: CallerRecord = {
    id: callerRow.id,
    name: callerRow.name,
    kind: callerRow.kind,
    status: callerRow.status,
    maxFileSizeBytes: callerRow.maxFileSizeBytes,
    allowedContentTypes: callerRow.allowedContentTypes,
    quotaBytes: callerRow.quotaBytes,
    rateLimitPerSec: callerRow.rateLimitPerSec,
    allowDirectUpload: callerRow.allowDirectUpload,
    allowDirectDownload: callerRow.allowDirectDownload,
    retentionDays: callerRow.retentionDays,
  };

  if (!keyId) {
    return { caller, credential: null };
  }

  const credentialRows = await db
    .select()
    .from(callerCredentials)
    .where(
      and(
        eq(callerCredentials.callerId, callerId),
        eq(callerCredentials.keyId, keyId),
        isNull(callerCredentials.revokedAt),
        isNull(callerCredentials.deletedAt),
      ),
    )
    .limit(1);
  const credentialRow = credentialRows[0];
  if (!credentialRow) {
    return { caller, credential: null };
  }

  return {
    caller,
    credential: {
      keyId: credentialRow.keyId,
      scopes: credentialRow.scopes,
      allowedCidrs: credentialRow.allowedCidrs,
      allowedTypes: credentialRow.allowedTypes,
      maxFileSizeBytes: credentialRow.maxFileSizeBytes,
      rateLimitPerSec: credentialRow.rateLimitPerSec,
    },
  };
}
