import type { ChildProcess } from 'node:child_process';
import { defaultKeyHasher } from '@better-auth/api-key';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as v from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createStorageAdapter } from '../../../packages/storage/src/index.ts';
import { ensureTestBuckets } from '../../../packages/storage/tests/ensure-buckets.ts';

const enabled = process.env.FMS_HTTP_INTEGRATION === '1';

const createdSchema = v.object({ fileId: v.string(), objectKey: v.string() });

async function ephemeralPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  try {
    const address = listener.address();
    if (!address || !(address instanceof Object)) throw new Error('HTTP_FIXTURE_ADDRESS_INVALID');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  }
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 1000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}

test.runIf(enabled)(
  'built HTTP boundary isolates tenants, rejects closed uploads, and seals streamed bytes once',
  async () => {
    const configuredUrl = new URL(process.env.DB_URL ?? '');
    expect(['postgres:', 'postgresql:']).toContain(configuredUrl.protocol);
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(configuredUrl.hostname);
    expect(['/audit_test', '/open-fms']).toContain(configuredUrl.pathname);
    expect(configuredUrl.search).toBe('');
    const storageUrl = new URL(process.env.STORAGE_TEST_ENDPOINT ?? '');
    expect(storageUrl.protocol).toBe('http:');
    expect(['127.0.0.1', 'localhost', '[::1]']).toContain(storageUrl.hostname);
    expect(storageUrl.username).toBe('');
    expect(storageUrl.password).toBe('');
    expect(storageUrl.pathname).toBe('/');
    expect(storageUrl.search).toBe('');
    const storageEndpoint = storageUrl.origin;
    const databaseName = `http_boundary_${randomUUID().replaceAll('-', '')}`;
    const target = new URL(configuredUrl);
    target.pathname = `/${databaseName}`;
    const admin = postgres(configuredUrl.toString(), { max: 1, connect_timeout: 2 });
    const sql = postgres(target.toString(), { max: 1, connect_timeout: 2 });
    const backendId = randomUUID();
    const config = {
      id: backendId,
      name: databaseName,
      kind: 'rustfs',
      endpoint: storageEndpoint,
      region: 'us-east-1',
      quarantineBucket: 'fms-quarantine',
      cleanBucket: 'fms-clean',
      forensicBucket: null,
      credentialRef: 'env:http-fixture',
      forcePathStyle: true,
    } as const;
    const credentials = { accessKeyId: 'rustfsadmin', secretAccessKey: 'rustfsadmin' };
    const storage = createStorageAdapter({ config, credentials });
    const keys: string[] = [];
    let child: ChildProcess | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      const migrations = new URL('../../../packages/database/migrations/', import.meta.url);
      const directories = await readdir(migrations, { withFileTypes: true });
      directories.sort((left, right) => left.name.localeCompare(right.name));
      for (const directory of directories) {
        if (directory.isDirectory()) {
          await sql.unsafe(
            await readFile(new URL(`${directory.name}/migration.sql`, migrations), 'utf8'),
          );
        }
      }
      await ensureTestBuckets({ config, credentials });
      await sql`INSERT INTO fms.storage_backends (id, name, kind, endpoint, region, quarantine_bucket, clean_bucket, credential_ref)
        VALUES (${backendId}, ${databaseName}, 'rustfs', ${storageEndpoint}, 'us-east-1', ${config.quarantineBucket}, ${config.cleanBucket}, 'env:http-fixture')`;
      async function seedCaller(): Promise<{ id: string; key: string }> {
        const id = randomUUID();
        const userId = randomUUID();
        const keyId = randomUUID();
        const key = `http_fixture_${randomUUID()}`;
        const email = `${userId}@example.test`;
        await sql`INSERT INTO fms.auth_users (id, name, email, email_verified) VALUES (${userId}, 'HTTP fixture', ${email}, true)`;
        await sql`INSERT INTO fms.callers (id, owner_user_id, name, owner_email, owner_verified_at, created_by)
          VALUES (${id}, ${userId}, ${id}, ${email}, now(), ${userId})`;
        await sql`INSERT INTO fms.auth_api_keys (id, reference_id, key, rate_limit_enabled, expires_at)
          VALUES (${keyId}, ${userId}, ${await defaultKeyHasher(key)}, false, now() + interval '1 hour')`;
        await sql`INSERT INTO fms.caller_credentials (id, caller_id, label, key_prefix, key_id, scopes, expires_at, created_by)
          VALUES (${randomUUID()}, ${id}, 'HTTP fixture', 'http_fixture_', ${keyId}, ARRAY['uploads:write', 'files:read'], now() + interval '1 hour', ${userId})`;
        return { id, key };
      }
      const owner = await seedCaller();
      const other = await seedCaller();
      const port = await ephemeralPort();
      const origin = `http://127.0.0.1:${port}`;
      child = spawn(
        process.execPath,
        [fileURLToPath(new URL('../.output/server/index.mjs', import.meta.url))],
        {
          env: {
            PATH: process.env.PATH,
            NODE_ENV: 'test',
            HOST: '127.0.0.1',
            PORT: String(port),
            NITRO_HOST: '127.0.0.1',
            NITRO_PORT: String(port),
            DB_URL: target.toString(),
            BETTER_AUTH_URL: origin,
            BETTER_AUTH_SECRET: 'dummy-http-boundary-secret-at-least-32-characters',
            MAIL_MODE: 'mock',
            OTEL_ENABLED: 'false',
            STORAGE_ACCESS_KEY_ID: credentials.accessKeyId,
            STORAGE_SECRET_ACCESS_KEY: credentials.secretAccessKey,
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let logs = '';
      child.stdout?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-8000);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        logs = (logs + chunk.toString()).slice(-8000);
      });
      const deadline = Date.now() + 8000;
      while (true) {
        try {
          if ((await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) })).ok) break;
        } catch {
          /* The child has not bound its listener yet. */
        }
        if (Date.now() >= deadline || child.exitCode !== null)
          throw new Error(`HTTP_FIXTURE_START_FAILED: ${logs}`);
        await delay(50);
      }
      function request(
        path: string,
        key = owner.key,
        method = 'GET',
        body?: string,
      ): Promise<Response> {
        const options = {
          method,
          headers: { 'x-api-key': key, 'content-type': 'application/octet-stream' },
          body,
          signal: AbortSignal.timeout(3000),
        };
        return fetch(`${origin}/api/v1/${path}`, options);
      }
      async function createUpload(
        mode: 'proxy_single' | 'proxy_parts',
        size = 3,
      ): Promise<v.InferOutput<typeof createdSchema>> {
        const response = await fetch(`${origin}/api/v1/uploads`, {
          method: 'POST',
          headers: { 'x-api-key': owner.key, 'content-type': 'application/json' },
          body: JSON.stringify({
            storageBackendId: backendId,
            originalFilename: 'fixture.bin',
            declaredContentType: 'application/octet-stream',
            declaredSizeBytes: size,
            mode,
          }),
          signal: AbortSignal.timeout(3000),
        });
        expect(response.status, `${await response.clone().text()}\n${logs}`).toBe(200);
        const created = v.parse(createdSchema, await response.json());
        keys.push(created.objectKey);
        return created;
      }
      expect(
        (await fetch(`${origin}/api/v1/uploads`, { signal: AbortSignal.timeout(3000) })).status,
      ).toBe(401);
      expect((await request('admin/settings/signup')).status).toBe(403);
      const single = await createUpload('proxy_single');
      for (const path of [
        `files/${single.fileId}`,
        `files/${single.fileId}/content`,
        `uploads/${single.fileId}`,
      ]) {
        expect((await request(path, other.key)).status).toBe(404);
      }
      expect(
        (await request(`uploads/${single.fileId}/content`, other.key, 'PUT', 'bad')).status,
      ).toBe(404);
      expect(
        (await request(`uploads/${single.fileId}/parts/1`, owner.key, 'PUT', 'abc')).status,
      ).toBe(409);
      expect((await request(`uploads/${single.fileId}/complete`, owner.key, 'POST')).status).toBe(
        409,
      );
      expect(
        (
          await sql`SELECT bytes_reserved::int, bytes_used::int FROM fms.caller_usage WHERE caller_id = ${owner.id}`
        )[0],
      ).toMatchObject({ bytes_reserved: 3, bytes_used: 0 });
      const streamRequest = {
        method: 'PUT',
        headers: { 'x-api-key': owner.key, 'content-type': 'application/octet-stream' },
        body: new Blob(['a', 'bc']).stream(),
        duplex: 'half',
        signal: AbortSignal.timeout(5000),
      };
      const streamed = await fetch(
        `${origin}/api/v1/uploads/${single.fileId}/content`,
        streamRequest,
      );
      expect(streamed.status, await streamed.clone().text()).toBe(200);
      expect(await streamed.json()).toMatchObject({
        sizeBytes: 3,
        checksumSha256: createHash('sha256').update('abc').digest('base64url'),
      });
      const location = { bucket: config.quarantineBucket, key: single.objectKey };
      const before = await storage.headObject(location);
      expect(await new Response((await storage.getObject(location)).body).text()).toBe('abc');
      expect(
        (
          await sql`SELECT bytes_reserved::int, bytes_used::int FROM fms.caller_usage WHERE caller_id = ${owner.id}`
        )[0],
      ).toMatchObject({ bytes_reserved: 0, bytes_used: 3 });
      expect(
        (await sql`SELECT status FROM fms.files WHERE id = ${single.fileId}`)[0],
      ).toMatchObject({ status: 'quarantined' });
      expect(await sql`SELECT id FROM fms.scan_jobs WHERE file_id = ${single.fileId}`).toHaveLength(
        1,
      );
      expect(
        (await request(`uploads/${single.fileId}/content`, owner.key, 'PUT', 'bad')).status,
      ).toBe(409);
      expect((await storage.headObject(location)).etag).toBe(before.etag);
      expect(await new Response((await storage.getObject(location)).body).text()).toBe('abc');
      const multipart = await createUpload('proxy_parts');
      expect(
        (await request(`uploads/${multipart.fileId}/content`, owner.key, 'PUT', 'abc')).status,
      ).toBe(409);
      expect(
        (await request(`uploads/${multipart.fileId}/parts/1`, owner.key, 'PUT', 'abcd')).status,
      ).toBe(400);
      expect(
        (
          await sql`SELECT received_size_bytes::int, multipart_upload_id FROM fms.upload_sessions WHERE file_id = ${multipart.fileId}`
        )[0],
      ).toMatchObject({ received_size_bytes: 0, multipart_upload_id: null });
      await sql`UPDATE fms.upload_sessions SET expires_at = now() - interval '1 second' WHERE file_id = ${multipart.fileId}`;
      expect(
        (await request(`uploads/${multipart.fileId}/parts/1`, owner.key, 'PUT', 'abc')).status,
      ).toBe(409);
      expect(
        (await request(`uploads/${multipart.fileId}/complete`, owner.key, 'POST')).status,
      ).toBe(409);
      await sql`UPDATE fms.callers SET status = 'suspended' WHERE id = ${owner.id}`;
      for (const path of [
        `files/${single.fileId}`,
        `files/${single.fileId}/content`,
        `uploads/${multipart.fileId}`,
      ]) {
        expect((await request(path)).status).toBe(403);
      }
      expect(
        (await request(`uploads/${multipart.fileId}/parts/1`, owner.key, 'PUT', 'abc')).status,
      ).toBe(403);
      expect(
        (await request(`uploads/${single.fileId}/content`, owner.key, 'PUT', 'bad')).status,
      ).toBe(403);
      expect((await storage.headObject(location)).etag).toBe(before.etag);
    } finally {
      if (child) await stopServer(child);
      try {
        for (const key of keys)
          await storage.deleteObject({ bucket: config.quarantineBucket, key });
      } finally {
        storage.destroy();
        await sql.end({ timeout: 1 });
        await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
        await admin.end({ timeout: 1 });
      }
    }
  },
  55000,
);
