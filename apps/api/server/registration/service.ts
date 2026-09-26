import {
  approveCaller,
  consumeUploadPass,
  createSelfSignupCaller,
  issueSetupCode,
  loadSignupSettings,
  mintUploadPass,
  redeemSetupCode,
  revokeCallerCredential,
  rotateCallerCredential,
  saveSignupSettings,
  type SignupSettings,
} from '@open-fms/database';
import { getTokenPepper } from '../auth/pepper.ts';

export type SelfSignupInput = {
  name: string;
  ownerEmail: string;
};

export type RedeemSetupCodeInput = {
  code: string;
};

export type AdminApprovalInput = {
  callerId: string;
  approve: boolean;
};

export type RevokeCredentialInput = {
  reason: string;
};

export type SignupSettingsInput = SignupSettings;

export type RegistrationErrorCode =
  | 'SIGNUP_DISABLED'
  | 'SIGNUP_DOMAIN_NOT_ALLOWED'
  | 'SIGNUP_CREATE_FAILED'
  | 'SETUP_CODE_INVALID'
  | 'CALLER_NOT_FOUND'
  | 'CREDENTIAL_NOT_FOUND'
  | 'UPLOAD_PASS_INVALID'
  | 'UPLOAD_PASS_FILE_MISMATCH'
  | 'UPLOAD_PASS_CREATE_FAILED'
  | 'REGISTRATION_FAILED';

export type RegistrationFailure = {
  code: RegistrationErrorCode;
};

export function toRegistrationFailure(error: Error): RegistrationFailure {
  const known: RegistrationErrorCode[] = [
    'SIGNUP_DISABLED',
    'SIGNUP_DOMAIN_NOT_ALLOWED',
    'SIGNUP_CREATE_FAILED',
    'SETUP_CODE_INVALID',
    'CALLER_NOT_FOUND',
    'CREDENTIAL_NOT_FOUND',
    'UPLOAD_PASS_INVALID',
    'UPLOAD_PASS_FILE_MISMATCH',
    'UPLOAD_PASS_CREATE_FAILED',
    'REGISTRATION_FAILED',
  ];
  for (const code of known) {
    if (error.message === code) {
      return { code };
    }
  }
  return { code: 'REGISTRATION_FAILED' };
}

export async function handleSelfSignup(input: SelfSignupInput): Promise<{ callerId: string }> {
  const issued = await createSelfSignupCaller({
    name: input.name,
    ownerEmail: input.ownerEmail,
    pepper: getTokenPepper(),
  });
  return { callerId: issued.callerId };
}

export async function handleRedeemSetupCode(
  input: RedeemSetupCodeInput,
): Promise<{ callerId: string }> {
  return redeemSetupCode({ code: input.code, pepper: getTokenPepper() });
}

export async function handleAdminApproval(
  adminActorId: string,
  input: AdminApprovalInput,
): Promise<{ callerId: string; status: string }> {
  await approveCaller({
    callerId: input.callerId,
    adminActorId,
    approve: input.approve,
  });
  return {
    callerId: input.callerId,
    status: input.approve ? 'active' : 'disabled',
  };
}

export async function handleRevokeCredential(
  adminActorId: string,
  callerId: string,
  keyId: string,
  input: RevokeCredentialInput,
): Promise<void> {
  await revokeCallerCredential({
    callerId,
    keyId,
    reason: input.reason,
    adminActorId,
  });
}

export async function handleRotateCredential(
  adminActorId: string,
  callerId: string,
  keyId: string,
  newSecret: string,
): Promise<void> {
  const pepper = getTokenPepper();
  await rotateCallerCredential({
    callerId,
    keyId,
    newSecret,
    pepper,
    adminActorId,
  });
}

export async function handleMintUploadPass(input: {
  fileId: string;
  callerId: string;
}): Promise<{ passId: string; token: string; expiresAt: Date }> {
  const issued = await mintUploadPass({
    fileId: input.fileId,
    callerId: input.callerId,
    pepper: getTokenPepper(),
  });
  return {
    passId: issued.passId,
    token: issued.token,
    expiresAt: issued.expiresAt,
  };
}

export async function handleConsumeUploadPass(input: {
  token: string;
  fileId: string;
}): Promise<{ callerId: string; fileId: string }> {
  return consumeUploadPass({
    token: input.token,
    pepper: getTokenPepper(),
    fileId: input.fileId,
  });
}

export async function handleSignupSettings(): Promise<SignupSettings> {
  return loadSignupSettings();
}

export async function handleSaveSignupSettings(
  adminActorId: string,
  input: SignupSettingsInput,
): Promise<void> {
  await saveSignupSettings(input, adminActorId);
}

export async function handleIssueSetupCode(
  callerId: string,
): Promise<{ code: string; expiresAt: Date }> {
  const issued = await issueSetupCode(callerId, getTokenPepper());
  return { code: issued.code, expiresAt: issued.expiresAt };
}
