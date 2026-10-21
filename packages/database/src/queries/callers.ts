import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { authUsers } from '../auth/schema.ts';
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
  retentionDays: number | null;
};

export type CallerCredentialPolicy = {
  keyId: string;
  kind: 'standard' | 'restricted';
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
 * Loads FMS tenant policy. Better Auth owns keys and permissions;
 * CIDR and size limits stay in `caller_credentials`.
 */
export async function loadCallerContext(
  ownerUserId: string,
  keyId?: string,
): Promise<CallerContext | null> {
  const callerRows = await db
    .select()
    .from(callers)
    .where(
      and(
        eq(callers.ownerUserId, ownerUserId),
        eq(callers.status, 'active'),
        isNull(callers.deletedAt),
      ),
    )
    .limit(1);
  const callerRow = callerRows[0];
  if (!callerRow) {
    return null;
  }

  const [owner] = await db
    .select()
    .from(authUsers)
    .where(and(eq(authUsers.id, ownerUserId), eq(authUsers.emailVerified, true)));
  if (!owner || owner.email !== callerRow.ownerEmail || !callerRow.ownerVerifiedAt) return null;

  const caller: CallerRecord = {
    id: callerRow.id,
    name: callerRow.name,
    kind: callerRow.kind,
    status: callerRow.status,
    maxFileSizeBytes: callerRow.maxFileSizeBytes,
    allowedContentTypes: callerRow.allowedContentTypes,
    quotaBytes: callerRow.quotaBytes,
    rateLimitPerSec: callerRow.rateLimitPerSec,
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
        eq(callerCredentials.callerId, caller.id),
        eq(callerCredentials.keyId, keyId),
        isNull(callerCredentials.revokedAt),
        isNull(callerCredentials.deletedAt),
        gt(callerCredentials.expiresAt, new Date()),
      ),
    )
    .limit(1);
  const credentialRow = credentialRows[0];
  if (!credentialRow) {
    return null;
  }

  return {
    caller,
    credential: {
      keyId: credentialRow.keyId,
      kind: credentialRow.kind,
      allowedCidrs: credentialRow.allowedCidrs,
      allowedTypes: credentialRow.allowedTypes,
      maxFileSizeBytes: credentialRow.maxFileSizeBytes,
      rateLimitPerSec: credentialRow.rateLimitPerSec,
    },
  };
}

export async function consumeCallerRateLimit(
  callerId: string,
  limit: number | null,
): Promise<boolean> {
  if (limit === null) return true;
  if (limit < 1) return false;
  const reset = sql`(${callers.rateWindowStart} is null or ${callers.rateWindowStart} <= clock_timestamp() - interval '1 second')`;
  const rows = await db
    .update(callers)
    .set({
      rateWindowStart: sql`case when ${reset} then clock_timestamp() else ${callers.rateWindowStart} end`,
      rateWindowCount: sql`case when ${reset} then 1 else ${callers.rateWindowCount} + 1 end`,
    })
    .where(
      and(
        eq(callers.id, callerId),
        eq(callers.status, 'active'),
        isNull(callers.deletedAt),
        or(reset, sql`${callers.rateWindowCount} < ${limit}`),
      ),
    )
    .returning({ id: callers.id });
  return rows.length === 1;
}
