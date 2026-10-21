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
export {
  processNextScanJob,
  runScanWorker,
  runWorkerLoop,
  type ScanOutcome,
  type ScanWorkerConfig,
} from './worker.ts';

export { parseWorkerConfig } from './config.ts';
