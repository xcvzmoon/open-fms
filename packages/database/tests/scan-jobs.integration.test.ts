import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { expect, test } from 'vite-plus/test';

const adminUrl = process.env.SCAN_TEST_ADMIN_URL;
test.skipIf(!adminUrl)(
  'scan leases fence stale attempts, recover running work, and exhaust claims',
  async () => {
    if (!adminUrl) throw new Error('SCAN_TEST_ADMIN_REQUIRED');
    const databaseName = `scan_test_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(adminUrl, { max: 1 });
    const target = new URL(adminUrl);
    target.pathname = `/${databaseName}`;
    let close: (() => Promise<void>) | undefined;
    let fixture: ReturnType<typeof postgres> | undefined;
    const previousUrl = process.env.DB_URL;
    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      fixture = postgres(target.toString(), { max: 1 });
      await fixture.unsafe(`CREATE SCHEMA fms;
      CREATE TABLE fms.scan_jobs (
        id uuid PRIMARY KEY, file_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
        priority integer NOT NULL DEFAULT 0, attempt_count integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 2, scan_policy_version text, claimed_at timestamptz,
        claimed_by text, lease_token text, lease_expires_at timestamptz,
        available_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
        last_error text, row_version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz
      )`);
      process.env.DB_URL = target.toString();
      const queue = await import('../src/queries/scan-jobs.ts');
      const client = await import('../src/client.ts');
      close = client.closeDatabase;
      const id = randomUUID();
      await fixture`INSERT INTO fms.scan_jobs (id, file_id) VALUES (${id}, ${randomUUID()})`;
      const first = await queue.claimNextScanJob('first', 60000);
      if (!first) throw new Error('SCAN_TEST_CLAIM_FAILED');
      expect(first.attemptCount).toBe(1);
      expect(await queue.markScanJobRunning(id, 'wrong')).toBe(false);
      expect(await queue.markScanJobRunning(id, first.leaseToken)).toBe(true);
      await fixture`UPDATE fms.scan_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = ${id}`;
      expect(await queue.completeScanJob(id, first.leaseToken)).toBe(false);
      expect(await queue.heartbeatScanJob(id, first.leaseToken, 60000)).toBe(false);
      expect(await queue.reclaimExpiredScanLeases()).toBe(1);
      const second = await queue.claimNextScanJob('second', 60000);
      if (!second) throw new Error('SCAN_TEST_RECLAIM_FAILED');
      expect(second.attemptCount).toBe(2);
      expect(second.leaseToken).not.toBe(first.leaseToken);
      expect(
        await queue.failScanJob({
          jobId: id,
          leaseToken: first.leaseToken,
          reason: 'stale',
          retry: false,
        }),
      ).toBe(false);
      expect(await queue.markScanJobRunning(id, second.leaseToken)).toBe(true);
      await fixture`UPDATE fms.scan_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = ${id}`;
      expect(await queue.reclaimExpiredScanLeases()).toBe(1);
      expect(await queue.claimNextScanJob('third')).toBeNull();
      const rows =
        await fixture`SELECT status, last_error, attempt_count FROM fms.scan_jobs WHERE id = ${id}`;
      expect(rows[0]).toMatchObject({
        status: 'failed',
        last_error: 'SCAN_ATTEMPTS_EXHAUSTED',
        attempt_count: 2,
      });
    } finally {
      if (previousUrl === undefined) delete process.env.DB_URL;
      else process.env.DB_URL = previousUrl;
      await close?.();
      await fixture?.end({ timeout: 1 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end({ timeout: 1 });
    }
  },
);
