import type { MailEvent } from '../../mailer/src/events.ts';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { expect, test, vi } from 'vite-plus/test';
import { authFixtureMigrationSql, parseAuthFixtureDatabaseUrl } from './auth-fixture.ts';

const enabled = process.env.FMS_AUTH_BOUNDARY_INTEGRATION === '1';

test.runIf(enabled)(
  'operator signup verifies before promotion and server peer addresses isolate native auth rate buckets',
  async () => {
    const fixtureUrl = parseAuthFixtureDatabaseUrl(process.env.DB_URL);
    const adminUrl = fixtureUrl.toString();
    const databaseName = `auth_boundary_${randomUUID().replaceAll('-', '')}`;
    const admin = postgres(adminUrl, { max: 1 });
    const target = new URL(adminUrl);
    target.pathname = `/${databaseName}`;
    let fixture: ReturnType<typeof postgres> | undefined;
    let close: (() => Promise<void>) | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
      fixture = postgres(target.toString(), { max: 1 });
      await fixture.unsafe(authFixtureMigrationSql());
      vi.stubEnv('DB_URL', target.toString());
      vi.stubEnv('BETTER_AUTH_URL', 'https://auth.example.test');
      vi.stubEnv('BETTER_AUTH_SECRET', 'dummy-auth-boundary-secret-with-at-least-32-characters');
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('MAIL_MODE', 'mock');
      const { createAuth } = await import('../../../apps/api/server/auth/auth.ts');
      const { createAuthRequest } = await import('../../../apps/api/server/auth/request.ts');
      const { bootstrapAdmin, closeDatabase } = await import('@open-fms/database');
      close = closeDatabase;
      let verificationUrl = '';
      const mail = {
        notify(event: MailEvent): Promise<void> {
          if (event.type === 'auth.verify') verificationUrl = event.verifyUrl;
          return Promise.resolve();
        },
      };
      const publicAuth = createAuth(undefined, mail);
      const email = 'operator@example.test';
      const bootstrapAuth = createAuth(email, mail);
      const headers = new Headers({ origin: 'https://auth.example.test' });
      await publicAuth.api.signUpEmail({
        body: { email, name: 'Operator', password: 'dummy-long-password' },
        headers,
      });
      await bootstrapAuth.api.signUpEmail({
        body: { email: 'foreign@example.test', name: 'Foreign', password: 'dummy-long-password' },
        headers,
      });
      const empty = await fixture`SELECT id FROM fms.auth_users`;
      expect(empty).toHaveLength(0);
      const created = await bootstrapAuth.api.signUpEmail({
        body: { email, name: 'Operator', password: 'dummy-long-password' },
        headers,
      });
      expect(created.user.emailVerified).toBe(false);
      expect(new URL(verificationUrl).origin).toBe('https://auth.example.test');
      expect(new URL(verificationUrl).pathname).toBe('/api/auth/verify-email');
      await expect(bootstrapAdmin(created.user.id)).rejects.toThrow('VERIFIED_ACCOUNT_REQUIRED');
      const verified = await publicAuth.handler(
        createAuthRequest(new Request(verificationUrl), '192.0.2.10'),
      );
      expect(verified.status).toBeLessThan(400);
      await bootstrapAdmin(created.user.id);
      const promoted =
        await fixture`SELECT kind, status FROM fms.callers WHERE owner_user_id = ${created.user.id}`;
      expect(promoted).toHaveLength(1);
      expect(promoted[0]).toMatchObject({ kind: 'admin', status: 'active' });
      await publicAuth.api.signUpEmail({
        body: {
          email: 'still-denied@example.test',
          name: 'Public',
          password: 'dummy-long-password',
        },
        headers,
      });
      const unauthorized =
        await fixture`SELECT id FROM fms.auth_users WHERE email IN ('foreign@example.test', 'still-denied@example.test')`;
      expect(unauthorized).toHaveLength(0);
      function signIn(peer: string, claimed: string): Promise<Response> {
        return publicAuth.handler(
          createAuthRequest(
            new Request('https://auth.example.test/api/auth/sign-in/email', {
              method: 'POST',
              headers: {
                origin: 'https://auth.example.test',
                'content-type': 'application/json',
                'x-fms-client-ip': claimed,
                'x-forwarded-for': claimed,
                'x-real-ip': claimed,
              },
              body: JSON.stringify({
                email: 'absent@example.test',
                password: 'dummy-wrong-password',
              }),
            }),
            peer,
          ),
        );
      }
      const firstClient = [
        (await signIn('192.0.2.1', '203.0.113.1')).status,
        (await signIn('192.0.2.1', '203.0.113.2')).status,
        (await signIn('192.0.2.1', '203.0.113.3')).status,
        (await signIn('192.0.2.1', '203.0.113.4')).status,
        (await signIn('192.0.2.1', '203.0.113.5')).status,
      ];
      expect(firstClient).toEqual([401, 401, 401, 401, 401]);
      expect((await signIn('192.0.2.1', '192.0.2.2')).status).toBe(429);
      const secondClient = [
        (await signIn('192.0.2.2', '192.0.2.1')).status,
        (await signIn('192.0.2.2', '192.0.2.1')).status,
        (await signIn('192.0.2.2', '192.0.2.1')).status,
        (await signIn('192.0.2.2', '192.0.2.1')).status,
        (await signIn('192.0.2.2', '192.0.2.1')).status,
      ];
      expect(secondClient).toEqual([401, 401, 401, 401, 401]);
      expect((await signIn('192.0.2.2', '203.0.113.200')).status).toBe(429);
    } finally {
      if (close) await close();
      if (fixture) await fixture.end({ timeout: 5 });
      await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
      vi.unstubAllEnvs();
    }
  },
  30000,
);
