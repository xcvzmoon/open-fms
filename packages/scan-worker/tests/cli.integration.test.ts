import type { ChildProcess } from 'node:child_process';
import type { Socket } from 'node:net';
import { eq, sql } from 'drizzle-orm';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as v from 'valibot';
import { afterAll, beforeAll, expect, test } from 'vite-plus/test';
import {
  authFixtureMigrationSql,
  parseAuthFixtureDatabaseUrl,
} from '../../database/tests/auth-fixture.ts';
import { ensureTestBuckets } from '../../storage/tests/ensure-buckets.ts';

const enabled = process.env.FMS_SCAN_INTEGRATION === '1';
const originalDatabaseUrl = process.env.DB_URL;
const databaseName = `scan_cli_${randomUUID().replaceAll('-', '')}`;
let admin: ReturnType<typeof postgres> | undefined;
let databaseOpened = false;
let databaseCreated = false;
let workerDatabaseUrl = '';
const endpointSchema = v.pipe(
  v.string(),
  v.url(),
  v.check((value) => {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === ''
    );
  }),
);
const fixtureSchema = v.object({
  STORAGE_TEST_ENDPOINT: endpointSchema,
  STORAGE_TEST_ACCESS_KEY_ID: v.picklist(['rustfsadmin', 'minioadmin']),
  STORAGE_TEST_SECRET_ACCESS_KEY: v.picklist(['rustfsadmin', 'minioadmin']),
});

beforeAll(async () => {
  if (!enabled) return;
  const target = parseAuthFixtureDatabaseUrl(originalDatabaseUrl);
  if (!v.safeParse(fixtureSchema, process.env).success) throw new Error('SCAN_FIXTURE_ENV_INVALID');
  admin = postgres(target.toString(), { max: 1, connect_timeout: 5 });
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  databaseCreated = true;
  target.pathname = `/${databaseName}`;
  workerDatabaseUrl = target.toString();
  const migration = postgres(workerDatabaseUrl, { max: 1, connect_timeout: 5 });
  try {
    await migration.unsafe(authFixtureMigrationSql());
  } finally {
    await migration.end({ timeout: 5 });
  }
  process.env.DB_URL = workerDatabaseUrl;
});

afterAll(async () => {
  try {
    if (databaseOpened) {
      const { closeDatabase } = await import('@open-fms/database');
      await closeDatabase();
    }
  } finally {
    if (originalDatabaseUrl === undefined) delete process.env.DB_URL;
    else process.env.DB_URL = originalDatabaseUrl;
    try {
      if (databaseCreated && admin)
        await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
    } finally {
      await admin?.end({ timeout: 5 });
    }
  }
});

async function clamFixture(verdict: 'clean' | 'infected', expected: Buffer) {
  const sockets = new Set<Socket>();
  let completed = 0;
  let protocolFailed = false;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {
      protocolFailed = true;
    });
    socket.setTimeout(5000, () => socket.destroy());
    let pending = Buffer.alloc(0);
    let commandRead = false;
    let size = 0;
    const hash = createHash('sha256');
    socket.on('data', (chunk: Buffer) => {
      if (pending.length + chunk.length > 131072) {
        protocolFailed = true;
        socket.destroy();
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      if (!commandRead) {
        if (pending.length < 10) return;
        if (!pending.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) {
          protocolFailed = true;
          socket.destroy();
          return;
        }
        commandRead = true;
        pending = pending.subarray(10);
      }
      while (pending.length >= 4) {
        const length = pending.readUInt32BE(0);
        if (length > 65536) {
          protocolFailed = true;
          socket.destroy();
          return;
        }
        if (pending.length < 4 + length) return;
        if (length === 0) {
          if (
            size !== expected.length ||
            !hash.digest().equals(createHash('sha256').update(expected).digest())
          )
            protocolFailed = true;
          completed += 1;
          socket.end(
            verdict === 'clean' ? 'stream: OK\0' : 'stream: Integration-Test-Signature FOUND\0',
          );
          return;
        }
        size += length;
        if (size > expected.length) {
          protocolFailed = true;
          socket.destroy();
          return;
        }
        hash.update(pending.subarray(4, 4 + length));
        pending = pending.subarray(4 + length);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || !(address instanceof Object)) throw new Error('SCAN_FIXTURE_ADDRESS');
  return {
    port: address.port,
    assertProtocol() {
      expect(protocolFailed).toBe(false);
      expect(completed).toBe(1);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

async function waitForExit(
  exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exit,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('SCAN_CLI_EXIT_TIMEOUT'));
        }, 8000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test.skipIf(process.env.FMS_SCAN_INTEGRATION !== '1').each(['clean', 'infected'] as const)(
  'packaged CLI processes %s verdict and exits cleanly on SIGTERM',
  async (verdict) => {
    const parsed = v.safeParse(fixtureSchema, process.env);
    if (!parsed.success) throw new Error('SCAN_FIXTURE_ENV_INVALID');
    const environment = parsed.output;
    const database = await import('@open-fms/database');
    expect(await database.db.execute(sql`SELECT current_database() AS name`)).toEqual([
      { name: databaseName },
    ]);
    databaseOpened = true;
    const lifecycle = await import('@open-fms/lifecycle');
    const { createStorageAdapter } = await import('@open-fms/storage');
    const id = randomUUID();
    const ownerId = `scan-cli-${id}`;
    const callerId = randomUUID();
    const backendId = randomUUID();
    const key = `scan-cli/${id}`;
    const bytes = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
      'hex',
    );
    const directory = await mkdtemp(join(tmpdir(), 'fms-cli-test-'));
    const clam = await clamFixture(verdict, bytes);
    const config = {
      id: backendId,
      name: `scan-cli-${id}`,
      kind: 'rustfs' as const,
      endpoint: environment.STORAGE_TEST_ENDPOINT,
      region: 'us-east-1',
      quarantineBucket: 'fms-quarantine',
      cleanBucket: 'fms-clean',
      forensicBucket: null,
      credentialRef: 'env:scan-cli-fixture',
      forcePathStyle: true,
    };
    const credentials = {
      accessKeyId: environment.STORAGE_TEST_ACCESS_KEY_ID,
      secretAccessKey: environment.STORAGE_TEST_SECRET_ACCESS_KEY,
    };
    const storage = createStorageAdapter({ config, credentials });
    let child: ChildProcess | undefined;
    let exit: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | undefined;
    let fileId: string | undefined;
    try {
      await ensureTestBuckets({ config, credentials });
      await database.db.insert(database.authUsers).values({
        id: ownerId,
        name: 'Scanner CLI fixture',
        email: `${id}@example.test`,
        emailVerified: true,
      });
      await database.db.insert(database.callers).values({
        id: callerId,
        ownerUserId: ownerId,
        ownerEmail: `${id}@example.test`,
        ownerVerifiedAt: new Date(),
        name: `scan-cli-${id}`,
        kind: 'app',
        status: 'active',
        signupSource: 'admin',
        maxFileSizeBytes: 1024,
        allowedContentTypes: ['image/png'],
        quotaBytes: 4096,
        createdBy: ownerId,
      });
      await database.db.insert(database.storageBackends).values(config);
      const created = await lifecycle.createFileWithUploadSession({
        callerId,
        storageBackendId: backendId,
        objectKey: key,
        originalFilename: 'fixture.png',
        declaredContentType: 'image/png',
        declaredSizeBytes: bytes.length,
        mode: 'proxy_single',
        expiresAt: new Date(Date.now() + 60000),
      });
      fileId = created.fileId;
      await lifecycle.markUploading({ fileId, expectedRowVersion: 1 });
      const uploaded = await storage.putObject({
        location: { bucket: config.quarantineBucket, key },
        body: bytes,
        contentType: 'image/png',
        contentLength: bytes.length,
      });
      await lifecycle.completeAndEnqueueScan({
        fileId,
        expectedRowVersion: 2,
        checksumSha256: createHash('sha256').update(bytes).digest(),
        sizeBytes: bytes.length,
        etag: uploaded.etag,
        sealedEtag: uploaded.etag,
        detectedContentType: 'image/png',
      });
      const [queued] = await database.db
        .select()
        .from(database.scanJobs)
        .where(eq(database.scanJobs.fileId, fileId));
      expect(queued?.status).toBe('pending');
      const workerId = `cli-${id}`;
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))],
        {
          cwd: directory,
          env: {
            NODE_ENV: 'test',
            DB_URL: workerDatabaseUrl,
            TMPDIR: directory,
            TMP: directory,
            TEMP: directory,
            S3_ACCESS_KEY_ID: credentials.accessKeyId,
            S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
            CLAMAV_HOST: '127.0.0.1',
            CLAMAV_PORT: String(clam.port),
            SCAN_WORKER_ID: workerId,
            SCAN_POLL_INTERVAL_MS: '25',
            SCAN_LEASE_MS: '6000',
            SCAN_JOB_TIMEOUT_MS: '10000',
            SCAN_CLAMAV_TIMEOUT_MS: '3000',
            SCAN_MAX_FILE_BYTES: '1024',
            AWS_EC2_METADATA_DISABLED: 'true',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let output = '';
      function capture(chunk: Buffer): void {
        output = (output + chunk.toString()).slice(-4096);
      }
      child.stdout?.on('data', capture);
      child.stderr?.on('data', capture);
      exit = new Promise((resolve, reject) => {
        child?.once('error', reject);
        child?.once('exit', (code, signal) => {
          resolve({ code, signal });
        });
      });
      const deadline = Date.now() + 15000;
      let completed = false;
      while (Date.now() < deadline) {
        if (child.exitCode !== null || child.signalCode !== null)
          throw new Error('SCAN_CLI_PREMATURE_EXIT');
        // oxlint-disable-next-line no-await-in-loop -- Observe each job state before waiting for the next poll.
        const file = await database.loadFileById(fileId);
        // oxlint-disable-next-line no-await-in-loop -- Observe each job state before waiting for the next poll.
        const [job] = await database.db
          .select()
          .from(database.scanJobs)
          .where(eq(database.scanJobs.fileId, fileId));
        if (file?.status === verdict && job?.status === 'succeeded') {
          expect(file.detectedContentType).toBe('image/png');
          expect(file.scannedAt).toBeInstanceOf(Date);
          expect(job.attemptCount).toBe(1);
          expect(job.leaseToken).toBeNull();
          completed = true;
          break;
        }
        // oxlint-disable-next-line no-await-in-loop -- Observe each job state before waiting for the next poll.
        await delay(50);
      }
      if (!completed) {
        const [lastJob] = await database.db
          .select({ status: database.scanJobs.status, lastError: database.scanJobs.lastError })
          .from(database.scanJobs)
          .where(eq(database.scanJobs.fileId, fileId));
        expect(lastJob).toMatchObject({ status: 'succeeded', lastError: null });
      }
      expect(completed, 'packaged worker must finish the queued fixture within its deadline').toBe(
        true,
      );
      clam.assertProtocol();
      if (verdict === 'clean')
        expect((await storage.headObject({ bucket: config.cleanBucket, key })).contentLength).toBe(
          bytes.length,
        );
      else await expect(storage.headObject({ bucket: config.cleanBucket, key })).rejects.toThrow();
      child.kill('SIGTERM');
      expect(await waitForExit(exit)).toEqual({ code: 0, signal: null });
      expect(output).toBe('');
      expect(await readdir(directory)).toEqual([]);
    } finally {
      try {
        if (child?.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          if (exit) await waitForExit(exit);
        }
        await clam.close();
        try {
          await storage.deleteObject({ bucket: config.quarantineBucket, key });
          await storage.deleteObject({ bucket: config.cleanBucket, key });
        } finally {
          storage.destroy();
        }
        if (fileId) await database.db.delete(database.files).where(eq(database.files.id, fileId));
        await database.db
          .delete(database.auditEvents)
          .where(eq(database.auditEvents.callerId, callerId));
        await database.db.delete(database.callers).where(eq(database.callers.id, callerId));
        await database.db
          .delete(database.storageBackends)
          .where(eq(database.storageBackends.id, backendId));
        await database.db.delete(database.authUsers).where(eq(database.authUsers.id, ownerId));
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
  30000,
);
