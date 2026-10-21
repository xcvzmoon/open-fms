import {
  claimNextScanJob,
  completeScanJob,
  failScanJob,
  heartbeatScanJob,
  reclaimExpiredScanLeases,
  loadFileById,
  loadScanCallerPolicy,
  loadStorageBackend,
  markScanJobRunning,
} from '@open-fms/database';
import { applyScanVerdict, markScanning } from '@open-fms/lifecycle';
import { createStorageAdapter } from '@open-fms/storage';
import { fileTypeFromBuffer } from 'file-type';
import { createReadStream } from 'node:fs';
import * as v from 'valibot';
import { checkArchiveFile, checkContentType } from './checks.ts';
import { createClamAvClient } from './clamav.ts';
import { maintainLease } from './lease.ts';
import { runWorkerLoop } from './loop.ts';
import { spoolObject } from './spool.ts';

export { runWorkerLoop } from './loop.ts';

export type ScanWorkerConfig = {
  workerId: string;
  storageCredentials: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string | undefined;
  };
  clamAv: { host: string; port: number; timeoutMs: number };
  maxFileBytes: number;
  leaseMs: number;
  jobTimeoutMs: number;
  pollIntervalMs: number;
};
export type ScanOutcome = {
  status: 'clean' | 'infected' | 'rejected' | 'failed' | 'skipped';
  reason: string | null;
};

export async function processNextScanJob(
  config: ScanWorkerConfig,
  signal: AbortSignal,
): Promise<ScanOutcome> {
  signal.throwIfAborted();
  const claimed = await claimNextScanJob(config.workerId, config.leaseMs);
  if (!claimed) return { status: 'skipped', reason: null };
  const controller = new AbortController();
  const workSignal = AbortSignal.any([
    signal,
    controller.signal,
    AbortSignal.timeout(config.jobTimeoutMs),
  ]);
  const heartbeatStop = new AbortController();
  const heartbeat = maintainLease(
    () => heartbeatScanJob(claimed.id, claimed.leaseToken, config.leaseMs),
    config.leaseMs,
    () => {
      controller.abort();
    },
    heartbeatStop.signal,
  );
  let storage: ReturnType<typeof createStorageAdapter> | undefined;
  const destroyStorage = () => {
    storage?.destroy();
  };
  workSignal.addEventListener('abort', destroyStorage, { once: true });
  let spool: Awaited<ReturnType<typeof spoolObject>> | undefined;
  try {
    if (!(await markScanJobRunning(claimed.id, claimed.leaseToken)))
      throw new Error('SCAN_LEASE_LOST');
    const file = await loadFileById(claimed.fileId);
    if (
      file &&
      (file.status === 'clean' || file.status === 'infected' || file.status === 'rejected')
    ) {
      if (!(await completeScanJob(claimed.id, claimed.leaseToken)))
        throw new Error('SCAN_LEASE_LOST');
      return { status: file.status, reason: 'SCAN_VERDICT_ALREADY_APPLIED' };
    }
    if (!file || !['quarantined', 'scanning'].includes(file.status))
      throw new Error('SCAN_FILE_STATE_INVALID');
    const callerPolicy = await loadScanCallerPolicy(file.callerId);
    if (!callerPolicy) throw new Error('SCAN_CALLER_MISSING');
    const backend = await loadStorageBackend(file.storageBackendId);
    if (!backend) throw new Error('SCAN_BACKEND_MISSING');
    storage = createStorageAdapter({
      config: { ...backend, forcePathStyle: backend.kind !== 's3' },
      credentials: config.storageCredentials,
    });
    let rowVersion = file.rowVersion;
    if (file.status === 'quarantined') {
      await markScanning({ fileId: file.id, expectedRowVersion: rowVersion });
      rowVersion += 1;
    }
    const sealedEtag = file.sealedEtag;
    if (
      !sealedEtag ||
      file.sizeBytes === null ||
      file.sizeBytes > Math.min(config.maxFileBytes, callerPolicy.maxFileSizeBytes)
    )
      throw new Error('SCAN_SEAL_INVALID');
    const object = await storage.getObject({
      bucket: backend.quarantineBucket,
      key: file.objectKey,
      expectedEtag: sealedEtag,
      abortSignal: workSignal,
    });
    spool = await spoolObject(
      v.parse(v.instance(ReadableStream<Uint8Array>), object.body),
      Math.min(file.sizeBytes, config.maxFileBytes, callerPolicy.maxFileSizeBytes),
      workSignal,
    );
    if (
      spool.sizeBytes !== file.sizeBytes ||
      (file.checksumSha256 && !spool.sha256.equals(file.checksumSha256))
    )
      throw new Error('SCAN_HASH_MISMATCH');
    const structure = await checkArchiveFile(
      spool.path,
      spool.prefix,
      spool.sizeBytes,
      undefined,
      workSignal,
    );
    const detected = await fileTypeFromBuffer(spool.prefix);
    const detectedContentType = detected?.mime ?? null;
    const mimeAllowed = checkContentType(
      detectedContentType,
      file.declaredContentType,
      callerPolicy.allowedContentTypes,
    );
    let verdict: 'clean' | 'infected' | 'rejected' = 'rejected';
    let reason = mimeAllowed ? structure.reason : 'SCAN_TYPE_DISALLOWED';
    if (structure.ok && mimeAllowed) {
      const clam = await createClamAvClient(config.clamAv).scanStream(
        createReadStream(spool.path),
        workSignal,
      );
      if (clam.status === 'error') throw new Error('SCAN_CLAMAV_ERROR');
      verdict = clam.status;
      reason = clam.signature ?? detected?.mime ?? null;
    }
    workSignal.throwIfAborted();
    const activeStorage = storage;
    await applyScanVerdict({
      fileId: file.id,
      expectedRowVersion: rowVersion,
      scanJobId: claimed.id,
      leaseToken: claimed.leaseToken,
      verdict,
      detectedContentType,
      storage: {
        copyObject: async (input) => {
          workSignal.throwIfAborted();
          const result = await activeStorage.copyObject({
            ...input,
            sourceEtag: sealedEtag,
            abortSignal: workSignal,
          });
          workSignal.throwIfAborted();
          return result;
        },
        headObject: async (input) => {
          workSignal.throwIfAborted();
          const result = await activeStorage.headObject({ ...input, abortSignal: workSignal });
          workSignal.throwIfAborted();
          return result;
        },
        deleteObject: async (input) => {
          workSignal.throwIfAborted();
          await activeStorage.deleteObject({ ...input, abortSignal: workSignal });
          workSignal.throwIfAborted();
        },
      },
      cleanBucket: backend.cleanBucket,
      quarantineBucket: backend.quarantineBucket,
      objectKey: file.objectKey,
      sealedEtag,
      scanPolicyVersion: file.scanPolicyVersion,
    });
    if (!(await completeScanJob(claimed.id, claimed.leaseToken)))
      throw new Error('SCAN_LEASE_LOST');
    return { status: verdict, reason };
  } catch {
    await failScanJob({
      jobId: claimed.id,
      leaseToken: claimed.leaseToken,
      reason: workSignal.aborted ? 'SCAN_ABORTED' : 'SCAN_FAILED',
      retry: true,
    });
    return { status: 'failed', reason: 'SCAN_FAILED' };
  } finally {
    workSignal.removeEventListener('abort', destroyStorage);
    heartbeatStop.abort();
    await heartbeat;
    try {
      await spool?.cleanup();
    } finally {
      storage?.destroy();
    }
  }
}

export async function runScanWorker(config: ScanWorkerConfig, signal: AbortSignal): Promise<void> {
  await runWorkerLoop(
    async () => {
      await reclaimExpiredScanLeases();
      return processNextScanJob(config, signal);
    },
    signal,
    config.pollIntervalMs,
  );
}
