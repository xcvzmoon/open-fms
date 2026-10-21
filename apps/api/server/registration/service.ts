import type { CredentialPolicyInput, SignupSettings } from '@open-fms/database';
import {
  approveCaller,
  createSelfSignupCaller,
  discardUnissuedKey,
  issueCallerCredential,
  issueSetupCode,
  loadPendingCaller,
  loadCredentialOwner,
  loadCredentialPolicy,
  loadSignupSettings,
  redeemSetupCode,
  revokeCallerCredential,
  saveSignupSettings,
} from '@open-fms/database';
import { auth } from '../auth/auth.ts';
import { getMailDispatch } from '../auth/mailer.ts';
import { getTokenPepper } from '../auth/pepper.ts';

export type RegistrationFailure = { code: string };

export function toRegistrationFailure(error: Error): RegistrationFailure {
  const known = [
    'SIGNUP_DISABLED',
    'SIGNUP_DOMAIN_NOT_ALLOWED',
    'SIGNUP_CREATE_FAILED',
    'SETUP_CODE_INVALID',
    'CALLER_NOT_FOUND',
    'CREDENTIAL_NOT_FOUND',
    'VERIFIED_ACCOUNT_REQUIRED',
  ];
  return { code: known.includes(error.message) ? error.message : 'REGISTRATION_FAILED' };
}

export async function handleSelfSignup(
  name: string,
  userId: string,
  email: string,
): Promise<{ callerId: string }> {
  const issued = await createSelfSignupCaller({
    name,
    ownerUserId: userId,
    pepper: getTokenPepper(),
  });
  await getMailDispatch().notify({ type: 'auth.setup-code', email, code: issued.code });
  return { callerId: issued.callerId };
}

export async function handleRedeemSetupCode(
  code: string,
  userId: string,
): Promise<{ callerId: string }> {
  return redeemSetupCode({ code, ownerUserId: userId, pepper: getTokenPepper() });
}

export async function handleAdminApproval(
  adminActorId: string,
  input: { callerId: string; approve: boolean },
): Promise<{ callerId: string }> {
  await approveCaller({ ...input, adminActorId });
  return { callerId: input.callerId };
}

export async function handleRevokeCredential(
  adminActorId: string,
  callerId: string,
  keyId: string,
  input: { reason: string },
): Promise<void> {
  await revokeCallerCredential({ callerId, keyId, reason: input.reason, adminActorId });
}

export async function handleIssueCredential(
  adminActorId: string,
  callerId: string,
  policy: CredentialPolicyInput,
  oldKeyId?: string,
): Promise<{ keyId: string; key: string; expiresAt: Date }> {
  const userId = await loadCredentialOwner(callerId);
  const expiresIn = 180 * 24 * 60 * 60;
  const key = await auth.api.createApiKey({
    body: {
      userId,
      name: policy.label,
      expiresIn,
      rateLimitEnabled: policy.rateLimitPerSec !== null,
      rateLimitTimeWindow: 1000,
      rateLimitMax: policy.rateLimitPerSec ?? 100,
    },
  });
  const expiresAt = key.expiresAt ?? new Date(Date.now() + expiresIn * 1000);
  try {
    await issueCallerCredential(callerId, adminActorId, key.id, expiresAt, policy, oldKeyId);
  } catch (error) {
    await discardUnissuedKey(key.id);
    throw error;
  }
  return { keyId: key.id, key: key.key, expiresAt };
}

export async function handleRotateCredential(
  adminActorId: string,
  callerId: string,
  keyId: string,
): Promise<{ keyId: string; key: string; expiresAt: Date }> {
  const policy = await loadCredentialPolicy(callerId, keyId);
  return handleIssueCredential(adminActorId, callerId, policy, keyId);
}

export async function handleSignupSettings(): Promise<SignupSettings> {
  return loadSignupSettings();
}

export async function handleSaveSignupSettings(
  adminActorId: string,
  input: SignupSettings,
): Promise<void> {
  await saveSignupSettings(input, adminActorId);
}

export async function handleResendSetupCode(userId: string): Promise<{ callerId: string }> {
  const pending = await loadPendingCaller(userId);
  const issued = await issueSetupCode(pending.callerId, getTokenPepper());
  await getMailDispatch().notify({
    type: 'auth.setup-code',
    email: pending.email,
    code: issued.code,
  });
  return { callerId: pending.callerId };
}
