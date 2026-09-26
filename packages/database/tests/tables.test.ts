import { getTableColumns, getTableSchema } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vite-plus/test';
import {
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
  uploadParts,
  uploadSessions,
} from '../src/tables/index.ts';

const tables = {
  storageBackends,
  callers,
  callerCredentials,
  setupCodes,
  serviceSettings,
  files,
  uploadSessions,
  uploadParts,
  scanJobs,
  scanResults,
  callerUsage,
  auditEvents,
} as const;

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.map((entry) => entry.config.name ?? '');
}

function uniqueNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).uniqueConstraints.map((entry) => entry.name ?? '');
}

describe('table placement', () => {
  test('every table lives in the fms schema', () => {
    for (const table of Object.values(tables)) {
      expect(getTableSchema(table)).toBe('fms');
    }
  });
});

describe('registration tables', () => {
  test('storageBackends has the status index and storage routing columns', () => {
    const columns = getTableColumns(storageBackends);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'quarantineBucket',
        'cleanBucket',
        'forensicBucket',
        'credentialRef',
      ]),
    );
    expect(indexNames(storageBackends)).toEqual(['storage_backends_status_idx']);
  });

  test('callers exposes quota, capability, and audit actor columns', () => {
    const columns = getTableColumns(callers);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'maxFileSizeBytes',
        'quotaBytes',
        'allowDirectUpload',
        'allowDirectDownload',
        'signupSource',
        'createdBy',
        'updatedBy',
        'deletedBy',
      ]),
    );
  });

  test('callerCredentials stores hashed secrets, revocation fields, and audit actors', () => {
    const columns = getTableColumns(callerCredentials);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'keyId',
        'secretHash',
        'pepperVersion',
        'expiresAt',
        'revokedAt',
        'revokedReason',
        'createdBy',
        'updatedBy',
        'deletedBy',
      ]),
    );
  });

  test('setupCodes stores only the code hash plus standard timestamps', () => {
    const columns = getTableColumns(setupCodes);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'codeHash',
        'expiresAt',
        'redeemedAt',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
    );
  });
});

describe('files', () => {
  test('tracks lifecycle status, row version, and integrity fields', () => {
    const columns = getTableColumns(files);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'objectKey',
        'checksumSha256',
        'sealedEtag',
        'status',
        'rowVersion',
        'idempotencyKey',
        'legalHold',
        'purgeAfter',
      ]),
    );
    expect(indexNames(files)).toEqual([
      'files_caller_status_idx',
      'files_status_purge_after_idx',
      'files_storage_backend_id_idx',
      'files_object_key_idx',
    ]);
  });
});

describe('uploads', () => {
  test('uploadSessions are unique per file and indexed for sweeps', () => {
    const columns = getTableColumns(uploadSessions);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'fileId',
        'mode',
        'status',
        'partSizeBytes',
        'expiresAt',
        'rowVersion',
      ]),
    );
    expect(uniqueNames(uploadSessions)).toEqual(['upload_sessions_file_id_uq']);
    expect(indexNames(uploadSessions)).toEqual([
      'upload_sessions_caller_status_idx',
      'upload_sessions_status_expires_at_idx',
    ]);
  });

  test('uploadParts are unique per session and part number', () => {
    expect(uniqueNames(uploadParts)).toEqual(['upload_parts_session_part_uq']);
  });
});

describe('scanning', () => {
  test('scanJobs support claim, lease, and retry fields', () => {
    const columns = getTableColumns(scanJobs);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'status',
        'attemptCount',
        'maxAttempts',
        'claimedBy',
        'leaseExpiresAt',
        'availableAt',
        'rowVersion',
      ]),
    );
    expect(indexNames(scanJobs)).toEqual([
      'scan_jobs_status_available_at_idx',
      'scan_jobs_file_id_idx',
      'scan_jobs_lease_expires_at_idx',
    ]);
  });

  test('scanResults keep one verdict per job', () => {
    const columns = getTableColumns(scanResults);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['verdict', 'engine', 'details', 'scannedAt']),
    );
    expect(uniqueNames(scanResults)).toEqual(['scan_results_scan_job_id_uq']);
  });
});

describe('operations', () => {
  test('callerUsage tracks reserved, used, and file counts', () => {
    const columns = getTableColumns(callerUsage);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'bytesReserved',
        'bytesUsed',
        'fileCount',
        'rowVersion',
        'createdAt',
        'updatedAt',
        'deletedAt',
      ]),
    );
  });

  test('auditEvents are append-only with actor and target indexes', () => {
    const columns = getTableColumns(auditEvents);
    expect(Object.keys(columns)).not.toContain('updatedAt');
    expect(Object.keys(columns)).not.toContain('deletedAt');
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining(['occurredAt', 'actorType', 'action', 'outcome', 'metadata']),
    );
    expect(indexNames(auditEvents)).toEqual([
      'audit_events_occurred_at_idx',
      'audit_events_actor_idx',
      'audit_events_target_idx',
      'audit_events_caller_occurred_at_idx',
      'audit_events_action_idx',
    ]);
  });
});
