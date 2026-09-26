import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import * as v from 'valibot';
import { db } from '../client.ts';
import { isEmailDomainAllowed } from '../security/email.ts';
import {
  generateHashedToken,
  hashToken,
  verifyTokenHash,
  type TokenPepper,
} from '../security/tokens.ts';
import {
  auditEvents,
  callerCredentials,
  callers,
  serviceSettings,
  setupCodes,
  uploadPasses,
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

export type IssuedUploadPass = {
  passId: string;
  token: string;
  fileId: string;
  callerId: string;
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
  const value = parsed.success ? parsed.output : {};
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
  const rows = await db
    .select()
    .from(serviceSettings)
    .where(eq(serviceSettings.key, 'signup'))
    .limit(1);
  if (rows[0]) {
    await db
      .update(serviceSettings)
      .set({ value: settings, updatedBy, updatedAt: new Date() })
      .where(eq(serviceSettings.key, 'signup'));
    return;
  }
  await db.insert(serviceSettings).values({
    key: 'signup',
    value: settings,
    updatedBy,
  });
}

export async function createSelfSignupCaller(input: {
  name: string;
  ownerEmail: string;
  pepper: TokenPepper;
}): Promise<IssuedSetupCode> {
  const settings = await loadSignupSettings();
  if (settings.mode !== 'self_signup') {
    throw new Error('SIGNUP_DISABLED');
  }
  if (!isEmailDomainAllowed(input.ownerEmail, settings.allowedDomains)) {
    throw new Error('SIGNUP_DOMAIN_NOT_ALLOWED');
  }

  const callerRows = await db
    .insert(callers)
    .values({
      name: input.name,
      kind: 'app',
      status: 'pending_verification',
      signupSource: 'self_signup',
      ownerEmail: input.ownerEmail,
      createdBy: randomUUID(),
    })
    .returning({ id: callers.id });
  const callerRow = callerRows[0];
  if (!callerRow) {
    throw new Error('SIGNUP_CREATE_FAILED');
  }

  return issueSetupCode(callerRow.id, input.pepper);
}

export async function issueSetupCode(
  callerId: string,
  pepper: TokenPepper,
): Promise<IssuedSetupCode> {
  const generated = generateHashedToken(pepper);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(setupCodes).values({
    callerId,
    codeHash: generated.hash,
    expiresAt,
  });
  return {
    callerId,
    code: generated.plaintext,
    expiresAt,
  };
}

export async function redeemSetupCode(input: {
  code: string;
  pepper: TokenPepper;
}): Promise<{ callerId: string }> {
  const now = new Date();
  const rows = await db
    .select()
    .from(setupCodes)
    .where(and(isNull(setupCodes.redeemedAt), gt(setupCodes.expiresAt, now)))
    .limit(50);

  const match = rows.find((row) => verifyTokenHash(input.code, row.codeHash, input.pepper));
  if (!match) {
    throw new Error('SETUP_CODE_INVALID');
  }

  const updated = await db
    .update(setupCodes)
    .set({ redeemedAt: now })
    .where(and(eq(setupCodes.id, match.id), isNull(setupCodes.redeemedAt)))
    .returning({ id: setupCodes.id });
  if (!updated[0]) {
    throw new Error('SETUP_CODE_INVALID');
  }

  await db.insert(auditEvents).values({
    actorType: 'system',
    action: 'setup_code.redeemed',
    targetType: 'caller',
    targetId: match.callerId,
    callerId: match.callerId,
    outcome: 'success',
    metadata: { setupCodeId: match.id },
  });
  return { callerId: match.callerId };
}

export async function approveCaller(input: {
  callerId: string;
  adminActorId: string;
  approve: boolean;
}): Promise<void> {
  const status = input.approve ? 'active' : 'disabled';
  const updated = await db
    .update(callers)
    .set({ status, updatedAt: new Date() })
    .where(eq(callers.id, input.callerId))
    .returning({ id: callers.id });
  if (!updated[0]) {
    throw new Error('CALLER_NOT_FOUND');
  }
  await db.insert(auditEvents).values({
    actorType: 'admin',
    actorId: input.adminActorId,
    action: input.approve ? 'caller.approved' : 'caller.rejected',
    targetType: 'caller',
    targetId: input.callerId,
    callerId: input.callerId,
    outcome: 'success',
  });
}

export async function revokeCallerCredential(input: {
  callerId: string;
  keyId: string;
  reason: string;
  adminActorId: string;
}): Promise<void> {
  const now = new Date();
  const updated = await db
    .update(callerCredentials)
    .set({ revokedAt: now, revokedReason: input.reason })
    .where(
      and(
        eq(callerCredentials.callerId, input.callerId),
        eq(callerCredentials.keyId, input.keyId),
        isNull(callerCredentials.revokedAt),
      ),
    )
    .returning({ id: callerCredentials.id });
  if (!updated[0]) {
    throw new Error('CREDENTIAL_NOT_FOUND');
  }
  await db.insert(auditEvents).values({
    actorType: 'admin',
    actorId: input.adminActorId,
    action: 'credential.revoked',
    targetType: 'caller_credential',
    targetId: updated[0].id,
    callerId: input.callerId,
    outcome: 'success',
    metadata: { keyId: input.keyId, reason: input.reason },
  });
}

export async function rotateCallerCredential(input: {
  callerId: string;
  keyId: string;
  newSecret: string;
  pepper: TokenPepper;
  adminActorId: string;
}): Promise<void> {
  const secretHash = hashToken(input.newSecret, input.pepper);
  const now = new Date();
  const updated = await db
    .update(callerCredentials)
    .set({
      secretHash,
      pepperVersion: input.pepper.version,
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
    })
    .where(
      and(
        eq(callerCredentials.callerId, input.callerId),
        eq(callerCredentials.keyId, input.keyId),
        isNull(callerCredentials.revokedAt),
      ),
    )
    .returning({ id: callerCredentials.id });
  if (!updated[0]) {
    throw new Error('CREDENTIAL_NOT_FOUND');
  }
  await db.insert(auditEvents).values({
    actorType: 'admin',
    actorId: input.adminActorId,
    action: 'credential.rotated',
    targetType: 'caller_credential',
    targetId: updated[0].id,
    callerId: input.callerId,
    outcome: 'success',
    metadata: { keyId: input.keyId, rotatedAt: now.toISOString() },
  });
}

export async function mintUploadPass(input: {
  fileId: string;
  callerId: string;
  pepper: TokenPepper;
  ttlSeconds?: number;
}): Promise<IssuedUploadPass> {
  const generated = generateHashedToken(input.pepper);
  const expiresAt = new Date(Date.now() + (input.ttlSeconds ?? 15 * 60) * 1000);
  const rows = await db
    .insert(uploadPasses)
    .values({
      fileId: input.fileId,
      callerId: input.callerId,
      tokenHash: generated.hash,
      pepperVersion: input.pepper.version,
      expiresAt,
    })
    .returning({ id: uploadPasses.id });
  const row = rows[0];
  if (!row) {
    throw new Error('UPLOAD_PASS_CREATE_FAILED');
  }
  return {
    passId: row.id,
    token: generated.plaintext,
    fileId: input.fileId,
    callerId: input.callerId,
    expiresAt,
  };
}

export async function consumeUploadPass(input: {
  token: string;
  pepper: TokenPepper;
  fileId: string;
}): Promise<{ callerId: string; fileId: string }> {
  const now = new Date();
  const rows = await db
    .select()
    .from(uploadPasses)
    .where(
      and(
        isNull(uploadPasses.revokedAt),
        isNull(uploadPasses.usedAt),
        gt(uploadPasses.expiresAt, now),
      ),
    )
    .limit(50);

  const match = rows.find((row) => verifyTokenHash(input.token, row.tokenHash, input.pepper));
  if (!match) {
    throw new Error('UPLOAD_PASS_INVALID');
  }
  if (match.fileId !== input.fileId) {
    throw new Error('UPLOAD_PASS_FILE_MISMATCH');
  }

  const updated = await db
    .update(uploadPasses)
    .set({ usedAt: now })
    .where(and(eq(uploadPasses.id, match.id), isNull(uploadPasses.usedAt)))
    .returning({ id: uploadPasses.id });
  if (!updated[0]) {
    throw new Error('UPLOAD_PASS_INVALID');
  }

  return { callerId: match.callerId, fileId: match.fileId };
}

export async function purgeExpiredSetupCodes(now = new Date()): Promise<number> {
  const deleted = await db
    .delete(setupCodes)
    .where(and(isNull(setupCodes.redeemedAt), lt(setupCodes.expiresAt, now)))
    .returning({ id: setupCodes.id });
  return deleted.length;
}
