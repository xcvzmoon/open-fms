import { and, eq, gt, inArray, isNull, lt } from 'drizzle-orm';
import * as v from 'valibot';
import { authApiKeys, authUsers } from '../auth/schema.ts';
import { db } from '../client.ts';
import { isEmailDomainAllowed } from '../security/email.ts';
import { generateHashedToken, hashToken, type TokenPepper } from '../security/tokens.ts';
import {
  auditEvents,
  callerCredentials,
  callers,
  serviceSettings,
  setupCodes,
} from '../tables/index.ts';

export type SignupSettings = {
  mode: 'disabled' | 'admin_approval' | 'self_signup';
  allowedDomains: string[];
  requireAdminApproval: boolean;
  maxPendingDays: number;
};

export const defaultSignupSettings: SignupSettings = {
  mode: 'admin_approval',
  allowedDomains: [],
  requireAdminApproval: true,
  maxPendingDays: 14,
};

const signupSettingsValueSchema = v.partial(
  v.object({
    mode: v.picklist(['disabled', 'admin_approval', 'self_signup']),
    allowedDomains: v.array(v.pipe(v.string(), v.minLength(1))),
    requireAdminApproval: v.boolean(),
    maxPendingDays: v.pipe(v.number(), v.integer(), v.minValue(1)),
  }),
);

export type IssuedSetupCode = {
  callerId: string;
  code: string;
  expiresAt: Date;
};

export { isEmailDomainAllowed };

export async function loadSignupSettings(): Promise<SignupSettings> {
  const rows = await db
    .select()
    .from(serviceSettings)
    .where(eq(serviceSettings.key, 'signup'))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return defaultSignupSettings;
  }
  const parsed = v.safeParse(signupSettingsValueSchema, row.value);
  if (!parsed.success) throw new Error('SIGNUP_SETTINGS_INVALID');
  const value = parsed.output;
  return {
    mode: value.mode ?? defaultSignupSettings.mode,
    allowedDomains: value.allowedDomains ?? defaultSignupSettings.allowedDomains,
    requireAdminApproval: value.requireAdminApproval ?? defaultSignupSettings.requireAdminApproval,
    maxPendingDays: value.maxPendingDays ?? defaultSignupSettings.maxPendingDays,
  };
}

export async function saveSignupSettings(
  settings: SignupSettings,
  updatedBy: string | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(serviceSettings)
      .values({ key: 'signup', value: settings, updatedBy })
      .onConflictDoUpdate({
        target: serviceSettings.key,
        set: { value: settings, updatedBy, updatedAt: new Date() },
      });
    await tx.insert(auditEvents).values({
      actorType: 'admin',
      actorId: updatedBy,
      action: 'signup.settings_updated',
      outcome: 'success',
      metadata: settings,
    });
  });
}

export async function assertSignupAllowed(email: string): Promise<void> {
  const settings = await loadSignupSettings();
  if (settings.mode === 'disabled') throw new Error('SIGNUP_DISABLED');
  if (!isEmailDomainAllowed(email, settings.allowedDomains))
    throw new Error('SIGNUP_DOMAIN_NOT_ALLOWED');
}

export async function createSelfSignupCaller(input: {
  name: string;
  ownerUserId: string;
  pepper: TokenPepper;
}): Promise<IssuedSetupCode> {
  const generated = generateHashedToken(input.pepper);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(authUsers)
      .where(and(eq(authUsers.id, input.ownerUserId), eq(authUsers.emailVerified, true)))
      .for('update');
    if (!user) throw new Error('VERIFIED_ACCOUNT_REQUIRED');
    await assertSignupAllowed(user.email);
    const [caller] = await tx
      .insert(callers)
      .values({
        name: input.name,
        ownerUserId: user.id,
        ownerEmail: user.email,
        kind: 'app',
        status: 'pending_verification',
        signupSource: 'self_signup',
        createdBy: user.id,
      })
      .returning();
    if (!caller) throw new Error('SIGNUP_CREATE_FAILED');
    await tx
      .insert(setupCodes)
      .values({ callerId: caller.id, codeHash: generated.hash, expiresAt });
    await tx.insert(auditEvents).values({
      actorType: 'caller',
      actorId: user.id,
      action: 'caller.registered',
      targetType: 'caller',
      targetId: caller.id,
      callerId: caller.id,
      outcome: 'success',
    });
    return { callerId: caller.id, code: generated.plaintext, expiresAt };
  });
}

export async function issueSetupCode(
  callerId: string,
  pepper: TokenPepper,
): Promise<IssuedSetupCode> {
  const generated = generateHashedToken(pepper);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.transaction(async (tx) => {
    const [caller] = await tx
      .select()
      .from(callers)
      .where(
        and(
          eq(callers.id, callerId),
          eq(callers.status, 'pending_verification'),
          isNull(callers.deletedAt),
        ),
      )
      .for('update');
    if (!caller) throw new Error('CALLER_NOT_FOUND');
    const [recent] = await tx
      .select()
      .from(setupCodes)
      .where(
        and(
          eq(setupCodes.callerId, callerId),
          gt(setupCodes.createdAt, new Date(Date.now() - 60000)),
        ),
      )
      .limit(1);
    if (recent) throw new Error('SETUP_CODE_RATE_LIMIT');
    await tx.delete(setupCodes).where(eq(setupCodes.callerId, callerId));
    await tx.insert(setupCodes).values({ callerId, codeHash: generated.hash, expiresAt });
    await tx.insert(auditEvents).values({
      actorType: 'system',
      action: 'setup_code.issued',
      callerId,
      targetType: 'caller',
      targetId: callerId,
      outcome: 'success',
    });
  });
  return { callerId, code: generated.plaintext, expiresAt };
}

export async function redeemSetupCode(input: {
  code: string;
  ownerUserId: string;
  pepper: TokenPepper;
}): Promise<{ callerId: string }> {
  const now = new Date();
  const settings = await loadSignupSettings();
  if (settings.mode === 'disabled') throw new Error('SIGNUP_DISABLED');
  return db.transaction(async (tx) => {
    const [caller] = await tx
      .select()
      .from(callers)
      .where(
        and(
          eq(callers.ownerUserId, input.ownerUserId),
          eq(callers.status, 'pending_verification'),
          isNull(callers.deletedAt),
        ),
      )
      .for('update');
    if (!caller || caller.createdAt.getTime() <= now.getTime() - settings.maxPendingDays * 86400000)
      throw new Error('SETUP_CODE_INVALID');
    const [user] = await tx
      .select()
      .from(authUsers)
      .where(and(eq(authUsers.id, input.ownerUserId), eq(authUsers.emailVerified, true)));
    if (!user || user.email !== caller.ownerEmail) throw new Error('VERIFIED_ACCOUNT_REQUIRED');
    const [code] = await tx
      .update(setupCodes)
      .set({ redeemedAt: now })
      .where(
        and(
          eq(setupCodes.callerId, caller.id),
          eq(setupCodes.codeHash, hashToken(input.code, input.pepper)),
          isNull(setupCodes.redeemedAt),
          gt(setupCodes.expiresAt, now),
        ),
      )
      .returning();
    if (!code) throw new Error('SETUP_CODE_INVALID');
    const needsApproval = settings.mode === 'admin_approval' || settings.requireAdminApproval;
    await tx
      .update(callers)
      .set({
        ownerVerifiedAt: now,
        status: !needsApproval || caller.approvedAt ? 'active' : 'pending_verification',
      })
      .where(eq(callers.id, caller.id));
    await tx.insert(auditEvents).values({
      actorType: 'caller',
      actorId: user.id,
      action: 'setup_code.redeemed',
      targetType: 'caller',
      targetId: caller.id,
      callerId: caller.id,
      outcome: 'success',
      metadata: { setupCodeId: code.id },
    });
    return { callerId: caller.id };
  });
}

export async function approveCaller(input: {
  callerId: string;
  adminActorId: string;
  approve: boolean;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [caller] = await tx
      .select()
      .from(callers)
      .where(and(eq(callers.id, input.callerId), isNull(callers.deletedAt)))
      .for('update');
    if (!caller) throw new Error('CALLER_NOT_FOUND');
    const [user] = await tx.select().from(authUsers).where(eq(authUsers.id, caller.ownerUserId));
    const now = new Date();
    await tx
      .update(callers)
      .set({
        approvedAt: input.approve ? now : null,
        status: input.approve
          ? caller.ownerVerifiedAt && user?.emailVerified && user.email === caller.ownerEmail
            ? 'active'
            : 'pending_verification'
          : 'disabled',
      })
      .where(eq(callers.id, caller.id));
    if (!input.approve) {
      await tx
        .update(callerCredentials)
        .set({ revokedAt: now, revokedReason: 'caller.disabled' })
        .where(eq(callerCredentials.callerId, caller.id));
      await tx
        .update(authApiKeys)
        .set({ enabled: false })
        .where(eq(authApiKeys.referenceId, caller.ownerUserId));
    }
    await tx.insert(auditEvents).values({
      actorType: 'admin',
      actorId: input.adminActorId,
      action: input.approve ? 'caller.approved' : 'caller.rejected',
      targetType: 'caller',
      targetId: caller.id,
      callerId: caller.id,
      outcome: 'success',
    });
  });
}

export async function revokeCallerCredential(input: {
  callerId: string;
  keyId: string;
  reason: string;
  adminActorId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [credential] = await tx
      .update(callerCredentials)
      .set({ revokedAt: new Date(), revokedReason: input.reason })
      .where(
        and(
          eq(callerCredentials.callerId, input.callerId),
          eq(callerCredentials.keyId, input.keyId),
          isNull(callerCredentials.revokedAt),
        ),
      )
      .returning();
    if (!credential) throw new Error('CREDENTIAL_NOT_FOUND');
    await tx.update(authApiKeys).set({ enabled: false }).where(eq(authApiKeys.id, input.keyId));
    await tx.insert(auditEvents).values({
      actorType: 'admin',
      actorId: input.adminActorId,
      action: 'credential.revoked',
      targetType: 'caller_credential',
      targetId: credential.id,
      callerId: input.callerId,
      outcome: 'success',
      metadata: { keyId: input.keyId, reason: input.reason },
    });
  });
}

export type CredentialPolicyInput = {
  label: string;
  kind: 'standard' | 'restricted';
  scopes: string[];
  allowedCidrs: string[];
  allowedTypes: string[];
  maxFileSizeBytes: number | null;
  rateLimitPerSec: number | null;
};

export async function issueCallerCredential(
  callerId: string,
  adminActorId: string,
  keyId: string,
  expiresAt: Date,
  policy: CredentialPolicyInput,
  oldKeyId?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [caller] = await tx
      .select()
      .from(callers)
      .where(and(eq(callers.id, callerId), eq(callers.status, 'active'), isNull(callers.deletedAt)))
      .for('update');
    if (!caller) throw new Error('CALLER_NOT_FOUND');
    const [user] = await tx
      .select()
      .from(authUsers)
      .where(and(eq(authUsers.id, caller.ownerUserId), eq(authUsers.emailVerified, true)))
      .for('update');
    if (!user || user.email !== caller.ownerEmail || !caller.ownerVerifiedAt)
      throw new Error('VERIFIED_ACCOUNT_REQUIRED');
    const [key] = await tx
      .select()
      .from(authApiKeys)
      .where(and(eq(authApiKeys.id, keyId), eq(authApiKeys.referenceId, caller.ownerUserId)));
    if (!key) throw new Error('CREDENTIAL_NOT_FOUND');
    await tx.insert(callerCredentials).values({
      ...policy,
      callerId,
      keyId,
      keyPrefix: key.start ?? '',
      expiresAt,
      createdBy: adminActorId,
    });
    if (oldKeyId) {
      const [old] = await tx
        .update(callerCredentials)
        .set({ revokedAt: new Date(), revokedReason: 'rotated' })
        .where(
          and(
            eq(callerCredentials.callerId, callerId),
            eq(callerCredentials.keyId, oldKeyId),
            isNull(callerCredentials.revokedAt),
          ),
        )
        .returning();
      if (!old) throw new Error('CREDENTIAL_NOT_FOUND');
      await tx.update(authApiKeys).set({ enabled: false }).where(eq(authApiKeys.id, oldKeyId));
    }
    await tx.insert(auditEvents).values({
      actorType: 'admin',
      actorId: adminActorId,
      action: oldKeyId ? 'credential.rotated' : 'credential.issued',
      callerId,
      outcome: 'success',
      metadata: { keyId, oldKeyId },
    });
  });
}

export async function bootstrapAdmin(ownerUserId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(authUsers)
      .where(and(eq(authUsers.id, ownerUserId), eq(authUsers.emailVerified, true)))
      .for('update');
    if (!user) throw new Error('VERIFIED_ACCOUNT_REQUIRED');
    const now = new Date();
    const [caller] = await tx
      .insert(callers)
      .values({
        ownerUserId,
        name: `admin:${ownerUserId}`,
        kind: 'admin',
        status: 'active',
        ownerEmail: user.email,
        ownerVerifiedAt: now,
        approvedAt: now,
        createdBy: ownerUserId,
      })
      .onConflictDoUpdate({
        target: callers.ownerUserId,
        set: {
          kind: 'admin',
          status: 'active',
          ownerEmail: user.email,
          ownerVerifiedAt: now,
          approvedAt: now,
          deletedAt: null,
        },
      })
      .returning();
    if (!caller) throw new Error('CALLER_NOT_FOUND');
    await tx.insert(auditEvents).values({
      actorType: 'system',
      actorId: ownerUserId,
      action: 'admin.bootstrapped',
      targetType: 'caller',
      targetId: caller.id,
      callerId: caller.id,
      outcome: 'success',
    });
  });
}

export async function purgeExpiredSetupCodes(now = new Date()): Promise<number> {
  const settings = await loadSignupSettings();
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(callers)
      .set({ status: 'disabled' })
      .where(
        and(
          eq(callers.status, 'pending_verification'),
          lt(callers.createdAt, new Date(now.getTime() - settings.maxPendingDays * 86400000)),
        ),
      )
      .returning({ id: callers.id });
    if (expired.length > 0) {
      const callerIds = expired.map(({ id }) => id);
      await tx.delete(setupCodes).where(inArray(setupCodes.callerId, callerIds));
      await tx
        .update(callerCredentials)
        .set({ revokedAt: now, revokedReason: 'caller.pending_expired' })
        .where(inArray(callerCredentials.callerId, callerIds));
      await tx.insert(auditEvents).values(
        expired.map(({ id }) => ({
          actorType: 'system' as const,
          action: 'caller.pending_expired',
          callerId: id,
          targetType: 'caller',
          targetId: id,
          outcome: 'success' as const,
        })),
      );
    }
    const deleted = await tx
      .delete(setupCodes)
      .where(lt(setupCodes.expiresAt, now))
      .returning({ id: setupCodes.id });
    return deleted.length;
  });
}

export async function loadCredentialOwner(callerId: string): Promise<string> {
  const [caller] = await db
    .select()
    .from(callers)
    .where(and(eq(callers.id, callerId), eq(callers.status, 'active'), isNull(callers.deletedAt)));
  if (!caller) throw new Error('CALLER_NOT_FOUND');
  return caller.ownerUserId;
}

export async function loadCredentialPolicy(
  callerId: string,
  keyId: string,
): Promise<CredentialPolicyInput> {
  const [credential] = await db
    .select()
    .from(callerCredentials)
    .where(
      and(
        eq(callerCredentials.callerId, callerId),
        eq(callerCredentials.keyId, keyId),
        isNull(callerCredentials.revokedAt),
        isNull(callerCredentials.deletedAt),
        gt(callerCredentials.expiresAt, new Date()),
      ),
    );
  if (!credential) throw new Error('CREDENTIAL_NOT_FOUND');
  return {
    label: credential.label,
    kind: credential.kind,
    scopes: credential.scopes,
    allowedCidrs: credential.allowedCidrs,
    allowedTypes: credential.allowedTypes,
    maxFileSizeBytes: credential.maxFileSizeBytes,
    rateLimitPerSec: credential.rateLimitPerSec,
  };
}

export async function discardUnissuedKey(keyId: string): Promise<void> {
  await db.update(authApiKeys).set({ enabled: false }).where(eq(authApiKeys.id, keyId));
}

export async function loadPendingCaller(
  ownerUserId: string,
): Promise<{ callerId: string; email: string }> {
  const settings = await loadSignupSettings();
  const [caller] = await db
    .select()
    .from(callers)
    .where(
      and(
        eq(callers.ownerUserId, ownerUserId),
        eq(callers.status, 'pending_verification'),
        isNull(callers.deletedAt),
        gt(callers.createdAt, new Date(Date.now() - settings.maxPendingDays * 86400000)),
      ),
    );
  if (!caller?.ownerEmail) throw new Error('CALLER_NOT_FOUND');
  return { callerId: caller.id, email: caller.ownerEmail };
}
