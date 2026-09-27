export {
  authAccounts,
  authApiKeys,
  authSchema,
  authSessions,
  authUsers,
  authVerifications,
} from './auth/schema.ts';
export { closeDatabase, db } from './client.ts';
export type { Database } from './client.ts';
export {
  generateTimestamps,
  generateTimestampsWithAudit,
  generateUuid,
  TIMESTAMP_CONFIG,
} from './helpers/index.ts';
export type { GenerateTimestampsWithAuditOptions } from './helpers/index.ts';
export {
  loadCallerContext,
  type CallerContext,
  type CallerCredentialPolicy,
  type CallerRecord,
} from './queries/callers.ts';
export { loadFileById, loadFileForCaller, type FileRecord } from './queries/files.ts';
export {
  approveCaller,
  consumeUploadPass,
  createSelfSignupCaller,
  defaultSignupSettings,
  isEmailDomainAllowed,
  issueSetupCode,
  loadSignupSettings,
  mintUploadPass,
  purgeExpiredSetupCodes,
  redeemSetupCode,
  revokeCallerCredential,
  rotateCallerCredential,
  saveSignupSettings,
  type IssuedSetupCode,
  type IssuedUploadPass,
  type SignupSettings,
} from './queries/registration.ts';
export {
  loadDefaultStorageBackend,
  loadStorageBackend,
  type StorageBackendRecord,
} from './queries/storage-backends.ts';
export {
  claimNextScanJob,
  completeScanJob,
  failScanJob,
  markScanJobRunning,
  reclaimExpiredScanLeases,
  type ClaimedScanJob,
} from './queries/scan-jobs.ts';
export { pingDatabase } from './queries/health.ts';
export {
  reconcileFileObjects,
  upsertCallerCredential,
  type ReconcileMismatch,
  type ReconcileResult,
  type ReconcileStorage,
} from './queries/reconcile.ts';
export {
  expireSetupCodes,
  expireUploadPasses,
  expireUploadSessions,
  listPurgeableFiles,
  listStaleUploadFiles,
  reclaimScanLeases,
  type PurgeableFile,
  type StaleUploadFile,
} from './queries/sweeps.ts';
export {
  attachMultipartUploadId,
  listUploadParts,
  loadUploadSessionByFileId,
  markUploadSessionStatus,
  recordUploadPart,
  type UploadPartRecord,
  type UploadSessionMode,
  type UploadSessionRecord,
} from './queries/uploads.ts';
export { fmsSchema } from './schema.ts';
export {
  generateHashedToken,
  generateToken,
  hashToken,
  verifyTokenHash,
  type GeneratedToken,
  type TokenPepper,
} from './security/tokens.ts';
export {
  auditEvents,
  callerCredentials,
  callers,
  callerUsage,
  files,
  scanJobs,
  scanResults,
  serviceSettings,
  setupCodes,
  storageBackends,
  uploadPasses,
  uploadParts,
  uploadSessions,
} from './tables/index.ts';
export { bytea } from './types.ts';
