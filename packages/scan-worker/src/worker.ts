import {
  claimNextScanJob,
  completeScanJob,
  failScanJob,
  loadFileById,
  loadStorageBackend,
  markScanJobRunning,
} from '@open-fms/database';
import { applyScanVerdict } from '@open-fms/lifecycle';
import { createStorageAdapter, type S3StorageAdapter } from '@open-fms/storage';
import {
  checkStructure,
  sniffContentType,
  verifyChecksum,
  type ScanCheckFailure,
} from './checks.ts';
import { createClamAvClient, type ClamAvClient } from './clamav.ts';

export type ScanWorkerConfig = {
  workerId: string;
  storageCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string | undefined;
  };
  clamAv?: { host: string; port: number; timeoutMs?: number } | undefined;
  pollIntervalMs?: number;
};

export type ScanOutcome = {
  status: 'clean' | 'infected' | 'rejected' | 'failed' | 'skipped';
  reason: string | null;
};

function isFileStatus(status: string): status is 'quarantined' | 'scanning' {
  return status === 'quarantined' || status === 'scanning';
}

async function loadObjectBytes(
  storage: S3StorageAdapter,
  bucket: string,
  key: string,
): Promise<Buffer> {
  const object = await storage.getObject({ bucket, key });
  const response = new Response(object.body);
  return Buffer.from(await response.arrayBuffer());
}

export async function processScanJob(
  jobId: string,
  config: ScanWorkerConfig,
): Promise<ScanOutcome> {
  const claimed = await claimNextScanJob(config.workerId);
  if (!claimed || claimed.id !== jobId) {
    return { status: 'skipped', reason: 'job_not_claimable' };
  }

  await markScanJobRunning(claimed.id);
  const file = await loadFileById(claimed.fileId);
  if (!file) {
    await failScanJob({ jobId: claimed.id, reason: 'FILE_NOT_FOUND', retry: false });
    return { status: 'failed', reason: 'FILE_NOT_FOUND' };
  }

  const backend = await loadStorageBackend(file.storageBackendId);
  if (!backend) {
    await failScanJob({ jobId: claimed.id, reason: 'STORAGE_BACKEND_MISSING', retry: false });
    return { status: 'failed', reason: 'STORAGE_BACKEND_MISSING' };
  }

  const storage = createStorageAdapter({
    config: {
      id: backend.id,
      name: backend.name,
      kind: backend.kind,
      endpoint: backend.endpoint,
      region: backend.region,
      quarantineBucket: backend.quarantineBucket,
      cleanBucket: backend.cleanBucket,
      forensicBucket: backend.forensicBucket,
      credentialRef: backend.credentialRef,
      forcePathStyle: backend.kind !== 's3',
    },
    credentials: config.storageCredentials,
  });

  try {
    const bytes = await loadObjectBytes(storage, backend.quarantineBucket, file.objectKey);
    const inspected = await sniffContentType(bytes);

    if (file.checksumSha256 && !verifyChecksum(bytes, file.checksumSha256)) {
      await failScanJob({ jobId: claimed.id, reason: 'SCAN_HASH_MISMATCH', retry: false });
      return { status: 'failed', reason: 'SCAN_HASH_MISMATCH' };
    }

    const structure = checkStructure(bytes);
    if (!structure.ok) {
      if (isFileStatus(file.status)) {
        await applyScanVerdict({
          fileId: file.id,
          expectedRowVersion: file.rowVersion,
          verdict: 'rejected',
          storage: {
            copyObject: (input) => storage.copyObject(input),
            headObject: (input) => storage.headObject(input),
            deleteObject: (input) => storage.deleteObject(input),
          },
          cleanBucket: backend.cleanBucket,
          quarantineBucket: backend.quarantineBucket,
          objectKey: file.objectKey,
          sealedEtag: file.sealedEtag ?? file.etag ?? '',
          scanPolicyVersion: file.scanPolicyVersion,
        });
      }
      await completeScanJob(claimed.id);
      return { status: 'rejected', reason: structure.reason };
    }

    if (config.clamAv) {
      const clam = createClamAvClient(config.clamAv);
      const verdict = await clam.scanBuffer(bytes);
      if (verdict.status === 'infected') {
        if (isFileStatus(file.status)) {
          await applyScanVerdict({
            fileId: file.id,
            expectedRowVersion: file.rowVersion,
            verdict: 'infected',
            storage: {
              copyObject: (input) => storage.copyObject(input),
              headObject: (input) => storage.headObject(input),
              deleteObject: (input) => storage.deleteObject(input),
            },
            cleanBucket: backend.cleanBucket,
            quarantineBucket: backend.quarantineBucket,
            objectKey: file.objectKey,
            sealedEtag: file.sealedEtag ?? file.etag ?? '',
            scanPolicyVersion: file.scanPolicyVersion,
          });
        }
        await completeScanJob(claimed.id);
        return { status: 'infected', reason: verdict.signature };
      }
      if (verdict.status === 'error') {
        await failScanJob({
          jobId: claimed.id,
          reason: `SCAN_CLAMAV_ERROR:${verdict.detail ?? 'unknown'}`,
          retry: true,
        });
        return { status: 'failed', reason: 'SCAN_CLAMAV_ERROR' };
      }
    }

    if (isFileStatus(file.status)) {
      await applyScanVerdict({
        fileId: file.id,
        expectedRowVersion: file.rowVersion,
        verdict: 'clean',
        storage: {
          copyObject: (input) => storage.copyObject(input),
          headObject: (input) => storage.headObject(input),
          deleteObject: (input) => storage.deleteObject(input),
        },
        cleanBucket: backend.cleanBucket,
        quarantineBucket: backend.quarantineBucket,
        objectKey: file.objectKey,
        sealedEtag: file.sealedEtag ?? file.etag ?? '',
        scanPolicyVersion: file.scanPolicyVersion,
      });
    }

    await completeScanJob(claimed.id);
    return {
      status: 'clean',
      reason: inspected.detectedMime,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'SCAN_FAILED';
    await failScanJob({
      jobId: claimed.id,
      reason,
      retry: claimed.attemptCount + 1 < claimed.maxAttempts,
    });
    return { status: 'failed', reason };
  } finally {
    storage.destroy();
  }
}

export type { ScanCheckFailure, ClamAvClient };
