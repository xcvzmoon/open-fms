import type { ApiKeyPermissions, CredentialPolicyInput } from '@open-fms/database';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import * as v from 'valibot';
import { expect, test, vi } from 'vite-plus/test';
import {
  authFixtureMigrationSql,
  parseAuthFixtureDatabaseUrl,
} from '../../../packages/database/tests/auth-fixture.ts';
import { ephemeralPort, stopServer } from './http-fixture.ts';

const enabled = process.env.FMS_AUTH_BOUNDARY_INTEGRATION === '1';
const issuedKeySchema = v.object({ keyId: v.string(), key: v.string() });

test.runIf(enabled)(
  'native permissions govern issuance, HTTP access, rotation, and revocation',
  async () => {
    const fixtureUrl = parseAuthFixtureDatabaseUrl(process.env.DB_URL);
    const databaseName = `key_permissions_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(fixtureUrl.toString(), { max: 1 });
    const target = new URL(fixtureUrl);
    target.pathname = `/${databaseName}`;
    const sql = postgres(target.toString(), { max: 1 });
    let close: (() => Promise<void>) | undefined;
    let child: ChildProcess | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      await sql.unsafe(authFixtureMigrationSql());
      const port = await ephemeralPort();
      const origin = `http://127.0.0.1:${port}`;
      const secret = 'dummy-permissions-fixture-secret-at-least-32-characters';
      vi.stubEnv('DB_URL', target.toString());
      vi.stubEnv('BETTER_AUTH_URL', origin);
      vi.stubEnv('BETTER_AUTH_SECRET', secret);
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('MAIL_MODE', 'mock');
      const { auth, createAuth } = await import('../server/auth/auth.ts');
      const { handleIssueCredential, handleRotateCredential, handleRevokeCredential } =
        await import('../server/registration/service.ts');
      const { closeDatabase } = await import('@open-fms/database');
      close = closeDatabase;
      const email = 'operator@example.test';
      const password = 'dummy-long-permissions-password';
      const bootstrap = createAuth(email, { notify: () => Promise.resolve() });
      const created = await bootstrap.api.signUpEmail({
        body: { email, password, name: 'Operator' },
      });
      const userId = created.user.id;
      const callerId = randomUUID();
      const otherUserId = randomUUID();
      const otherCallerId = randomUUID();
      await sql`UPDATE fms.auth_users SET email_verified = true WHERE id = ${userId}`;
      await sql`INSERT INTO fms.auth_users (id, name, email, email_verified)
        VALUES (${otherUserId}, 'Other', 'other@example.test', true)`;
      await sql`INSERT INTO fms.callers (id, owner_user_id, name, owner_email, owner_verified_at, kind, created_by)
        VALUES (${callerId}, ${userId}, 'Operator', ${email}, now(), 'admin', ${userId}),
        (${otherCallerId}, ${otherUserId}, 'Other', 'other@example.test', now(), 'app', ${userId})`;
      const policy: CredentialPolicyInput = {
        label: 'permission fixture',
        kind: 'standard',
        allowedCidrs: [],
        allowedTypes: [],
        maxFileSizeBytes: null,
        rateLimitPerSec: null,
      };
      async function issue(permissions: ApiKeyPermissions) {
        return handleIssueCredential(userId, callerId, policy, permissions);
      }
      const read = await issue({ files: ['read'] });
      const write = await issue({ uploads: ['write'] });
      const combined = await issue({ files: ['read'], uploads: ['write'] });
      const [stored] =
        await sql`SELECT key, permissions FROM fms.auth_api_keys WHERE id = ${read.keyId}`;
      expect(stored?.key).not.toBe(read.key);
      expect(stored?.permissions).toBe(JSON.stringify({ files: ['read'] }));
      expect(
        await sql`SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'fms' AND table_name = 'caller_credentials' AND column_name = 'scopes'`,
      ).toHaveLength(0);

      const rotated = await handleRotateCredential(userId, callerId, combined.keyId);
      expect((await auth.api.verifyApiKey({ body: { key: combined.key } })).valid).toBe(false);
      expect(
        await auth.api.verifyApiKey({
          body: { key: rotated.key, permissions: { files: ['read'], uploads: ['write'] } },
        }),
      ).toMatchObject({
        valid: true,
        key: { permissions: { files: ['read'], uploads: ['write'] } },
      });
      await expect(handleRotateCredential(userId, otherCallerId, read.keyId)).rejects.toThrow(
        'CREDENTIAL_NOT_FOUND',
      );
      const malformed = await issue({ files: ['read'] });
      await sql`UPDATE fms.auth_api_keys SET permissions = '{' WHERE id = ${malformed.keyId}`;
      await expect(handleRotateCredential(userId, callerId, malformed.keyId)).rejects.toThrow(
        'CREDENTIAL_PERMISSIONS_INVALID',
      );
      const legacy = await issue({ files: ['read'] });
      await sql`UPDATE fms.auth_api_keys SET permissions = NULL WHERE id = ${legacy.keyId}`;
      await expect(handleRotateCredential(userId, callerId, legacy.keyId)).rejects.toThrow(
        'CREDENTIAL_PERMISSIONS_INVALID',
      );
      const empty = await issue({ files: ['read'] });
      await sql`UPDATE fms.auth_api_keys SET permissions = '{}' WHERE id = ${empty.keyId}`;
      await expect(handleRotateCredential(userId, callerId, empty.keyId)).rejects.toThrow(
        'CREDENTIAL_PERMISSIONS_INVALID',
      );
      const racing = await issue({ files: ['read'] });
      const rotations = await Promise.allSettled([
        handleRotateCredential(userId, callerId, racing.keyId),
        handleRotateCredential(userId, callerId, racing.keyId),
      ]);
      expect(rotations.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(rotations.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect((await auth.api.verifyApiKey({ body: { key: racing.key } })).valid).toBe(false);
      const beforeFailure = await sql<{ id: string }[]>`SELECT id FROM fms.auth_api_keys`;
      await expect(
        handleIssueCredential(userId, callerId, policy, { files: ['read'] }, 'missing-key'),
      ).rejects.toThrow('CREDENTIAL_NOT_FOUND');
      const [discarded] = await sql`SELECT enabled FROM fms.auth_api_keys
        WHERE id NOT IN ${sql(beforeFailure.map(({ id }) => id))}`;
      expect(discarded?.enabled).toBe(false);
      expect((await auth.api.verifyApiKey({ body: { key: read.key } })).valid).toBe(true);

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
            BETTER_AUTH_SECRET: secret,
            MAIL_MODE: 'mock',
            OTEL_ENABLED: 'false',
          },
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      );
      let serverErrors = '';
      child.stderr?.on('data', (chunk: Buffer) => {
        serverErrors = (serverErrors + chunk.toString()).slice(-4000);
      });
      const deadline = Date.now() + 8000;
      while (true) {
        try {
          // oxlint-disable-next-line no-await-in-loop -- Probe the built server until its listener is ready.
          if ((await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(500) })).ok) break;
        } catch {
          if (child.exitCode !== null) throw new Error('PERMISSIONS_FIXTURE_START_FAILED');
        }
        if (Date.now() >= deadline) throw new Error('PERMISSIONS_FIXTURE_START_TIMEOUT');
        // oxlint-disable-next-line no-await-in-loop -- Retry readiness only after a short delay.
        await delay(50);
      }
      const fileId = randomUUID();
      function request(path: string, key: string, method = 'GET'): Promise<Response> {
        const options = {
          method,
          headers: { 'x-api-key': key, 'content-type': 'application/json' },
          body: method === 'POST' ? '{}' : undefined,
          signal: AbortSignal.timeout(3000),
        };
        return fetch(`${origin}/api/v1/${path}`, options);
      }
      expect((await request(`files/${fileId}`, read.key)).status).toBe(404);
      expect((await request(`uploads/${fileId}`, read.key, 'HEAD')).status).toBe(200);
      expect((await request(`uploads/${fileId}`, write.key, 'HEAD')).status).toBe(401);
      expect((await request('uploads', read.key, 'POST')).status).toBe(401);
      expect((await request(`files/${fileId}`, write.key)).status).toBe(401);
      expect((await request('uploads', write.key, 'POST')).status).toBe(400);
      expect((await request(`files/${fileId}`, rotated.key)).status).toBe(404);
      expect((await request('uploads', rotated.key, 'POST')).status).toBe(400);
      expect((await request(`files/${fileId}`, legacy.key)).status).toBe(401);
      expect((await request(`files/${fileId}`, malformed.key)).status).toBe(401);
      expect((await request(`files/${fileId}`, empty.key)).status).toBe(401);
      expect((await request('admin/settings/signup', read.key)).status).toBe(403);
      expect((await request('signup', read.key, 'POST')).status).toBe(403);
      expect((await request(`files/${fileId}`, 'invalid')).status).toBe(401);

      const restricted = await handleIssueCredential(
        userId,
        callerId,
        {
          ...policy,
          kind: 'restricted',
          allowedTypes: ['image/png'],
        },
        { uploads: ['write'] },
      );
      await sql`UPDATE fms.callers SET allowed_content_types = ARRAY['text/plain'] WHERE id = ${callerId}`;
      expect((await request('uploads', restricted.key, 'POST')).status).toBe(403);
      await sql`UPDATE fms.callers SET allowed_content_types = ARRAY[]::text[] WHERE id = ${callerId}`;
      const cidr = await handleIssueCredential(
        userId,
        callerId,
        {
          ...policy,
          allowedCidrs: ['192.0.2.0/24'],
        },
        { files: ['read'] },
      );
      expect((await request(`files/${fileId}`, cidr.key)).status).toBe(403);
      await sql`UPDATE fms.callers SET status = 'suspended' WHERE id = ${callerId}`;
      expect((await request(`files/${fileId}`, read.key)).status).toBe(403);
      await sql`UPDATE fms.callers SET status = 'disabled' WHERE id = ${callerId}`;
      expect((await request(`files/${fileId}`, read.key)).status).toBe(403);
      await sql`UPDATE fms.callers SET status = 'active' WHERE id = ${callerId}`;
      await sql`UPDATE fms.auth_users SET email_verified = false WHERE id = ${userId}`;
      expect((await request(`files/${fileId}`, read.key)).status).toBe(403);
      await sql`UPDATE fms.auth_users SET email_verified = true WHERE id = ${userId}`;

      const limited = await handleIssueCredential(
        userId,
        callerId,
        {
          ...policy,
          rateLimitPerSec: 2,
        },
        { files: ['read'] },
      );
      expect((await request('uploads', limited.key, 'POST')).status).toBe(401);
      expect(
        (await sql`SELECT request_count FROM fms.auth_api_keys WHERE id = ${limited.keyId}`)[0]
          ?.request_count,
      ).toBe(0);
      expect((await request(`files/${fileId}`, limited.key)).status).toBe(404);
      expect(
        (await sql`SELECT request_count FROM fms.auth_api_keys WHERE id = ${limited.keyId}`)[0]
          ?.request_count,
      ).toBe(1);
      await sql`UPDATE fms.callers SET rate_limit_per_sec = 1,
        rate_window_start = now(), rate_window_count = 1 WHERE id = ${callerId}`;
      expect((await request(`files/${fileId}`, read.key)).status).toBe(429);
      expect((await request(`files/${fileId}`, rotated.key)).status).toBe(429);
      await sql`UPDATE fms.callers SET rate_limit_per_sec = NULL WHERE id = ${callerId}`;

      const signIn = await fetch(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      expect(signIn.status, serverErrors).toBe(200);
      const cookie = signIn.headers
        .getSetCookie()
        .map((entry) => entry.split(';')[0])
        .join('; ');
      async function adminIssue(body: string): Promise<Response> {
        return fetch(`${origin}/api/v1/callers/${callerId}/keys`, {
          method: 'POST',
          headers: { cookie, origin, 'content-type': 'application/json' },
          body,
        });
      }
      expect((await adminIssue(JSON.stringify({ ...policy, scopes: ['files:read'] }))).status).toBe(
        400,
      );
      expect((await adminIssue(JSON.stringify({ ...policy, permissions: {} }))).status).toBe(400);
      expect(
        (
          await adminIssue(
            JSON.stringify({
              ...policy,
              scopes: ['files:read'],
              permissions: { files: ['read'] },
            }),
          )
        ).status,
      ).toBe(400);
      expect(
        (await adminIssue(JSON.stringify({ ...policy, permissions: { users: ['read'] } }))).status,
      ).toBe(400);
      expect(
        (
          await adminIssue(
            JSON.stringify({ ...policy, kind: 'restricted', permissions: { uploads: ['write'] } }),
          )
        ).status,
      ).toBe(400);
      const issuedResponse = await adminIssue(
        JSON.stringify({ ...policy, permissions: { files: ['read'] } }),
      );
      expect(issuedResponse.status).toBe(200);
      const issued = v.parse(issuedKeySchema, await issuedResponse.json());
      expect((await request(`files/${fileId}`, issued.key)).status).toBe(404);
      const publicMutation = await fetch(`${origin}/api/auth/api-key/create`, {
        method: 'POST',
        headers: { cookie, origin, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'bypass', permissions: { uploads: ['write'] } }),
      });
      expect(publicMutation.status).toBe(404);
      await handleRevokeCredential(userId, callerId, issued.keyId, { reason: 'test' });
      expect((await request(`files/${fileId}`, issued.key)).status).toBe(401);
      await expect(handleRotateCredential(userId, callerId, issued.keyId)).rejects.toThrow(
        'CREDENTIAL_NOT_FOUND',
      );
      const expiring = await issue({ files: ['read'] });
      await sql`UPDATE fms.auth_api_keys SET expires_at = now() - interval '1 second' WHERE id = ${expiring.keyId}`;
      await expect(handleRotateCredential(userId, callerId, expiring.keyId)).rejects.toThrow(
        'CREDENTIAL_NOT_FOUND',
      );
      expect((await request(`files/${fileId}`, expiring.key)).status).toBe(401);
      const expiredPolicy = await issue({ files: ['read'] });
      await sql`UPDATE fms.caller_credentials SET created_at = now() - interval '1 hour',
        expires_at = now() - interval '1 second'
        WHERE key_id = ${expiredPolicy.keyId}`;
      expect((await request(`files/${fileId}`, expiredPolicy.key)).status).toBe(403);
      await expect(handleRotateCredential(userId, callerId, expiredPolicy.keyId)).rejects.toThrow(
        'CREDENTIAL_NOT_FOUND',
      );
      expect(
        await sql`SELECT id FROM fms.audit_events WHERE action = 'credential.rotated' AND caller_id = ${callerId}`,
      ).toHaveLength(2);
    } finally {
      if (child) await stopServer(child);
      if (close) await close();
      await sql.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
      vi.unstubAllEnvs();
    }
  },
  30000,
);
