export {
  checkArchiveBomb,
  checkStructure,
  defaultArchiveBombPolicy,
  hashBytes,
  isZipLike,
  sniffContentType,
  verifyChecksum,
  type ArchiveBombPolicy,
  type ContentInspection,
  type ScanCheckFailure,
  type StructureCheckResult,
} from './checks.ts';
export { createClamAvClient, type ClamAvClient, type ClamAvVerdict } from './clamav.ts';
export { processScanJob, type ScanOutcome, type ScanWorkerConfig } from './worker.ts';
