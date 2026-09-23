import type * as EnvModule from '../../../server/utils/env.ts';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { setApiEnv, setValidApiEnv } from '../../support/env-fixture.ts';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function importEnv(): Promise<typeof EnvModule> {
  return import('../../../server/utils/env.ts');
}

describe('env', () => {
  it('parses a fully valid environment', async () => {
    setValidApiEnv({
      RESEND_API_KEY: 'resend-key',
    });

    const { env } = await importEnv();

    expect(env.web.origin).toBe('https://app.buildr.test');
    expect(env.google.client.id).toBe('google-client-id');
    expect(env.google.client.secret).toBe('google-client-secret');
    expect(env.dymo.apiKey).toBe('dymo-api-key');
    expect(env.email.from).toBe('Buildr <hello@buildr.test>');
    expect(env.resend.apiKey).toBe('resend-key');
  });

  it.each([
    'WEB_ORIGIN',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'DYMO_API_KEY',
    'EMAIL_FROM',
  ] as const)('throws when %s is missing', async (missingKey) => {
    setValidApiEnv({ [missingKey]: undefined });

    await expect(importEnv()).rejects.toThrow(/Invalid environment variables/);
  });

  it('rejects a WEB_ORIGIN that is not a URL', async () => {
    setValidApiEnv({ WEB_ORIGIN: 'not-a-url' });

    await expect(importEnv()).rejects.toThrow(/WEB_ORIGIN must be a valid URL/);
  });

  describe('optional env vars', () => {
    it('treats an unset optional var as absent', async () => {
      setValidApiEnv();

      const { env } = await importEnv();

      expect(env.resend.apiKey).toBeUndefined();
      expect(env.smtp.host).toBeUndefined();
      expect(env.smtp.port).toBeUndefined();
      expect(env.smtp.secure).toBeUndefined();
    });

    it('treats an empty-string optional var the same as absent', async () => {
      // dotenv leaves declared-but-unset vars (e.g. `SMTP_SECURE=`) as `''`
      // rather than omitting the key; env.ts documents this as intentional.
      setValidApiEnv({ SMTP_HOST: '', SMTP_SECURE: '' });

      const { env } = await importEnv();

      expect(env.smtp.host).toBeUndefined();
      expect(env.smtp.secure).toBeUndefined();
    });

    it('parses SMTP_PORT as an integer', async () => {
      setValidApiEnv({ SMTP_PORT: '2525' });

      const { env } = await importEnv();

      expect(env.smtp.port).toBe(2525);
    });

    it('rejects a non-integer SMTP_PORT', async () => {
      setValidApiEnv({ SMTP_PORT: 'not-a-number' });

      await expect(importEnv()).rejects.toThrow(/SMTP_PORT must be an integer/);
    });

    it('parses SMTP_SECURE "true"/"false" into a boolean', async () => {
      setValidApiEnv({ SMTP_SECURE: 'true' });
      const trueResult = await importEnv();
      expect(trueResult.env.smtp.secure).toBe(true);

      vi.resetModules();
      setValidApiEnv({ SMTP_SECURE: 'false' });
      const falseResult = await importEnv();
      expect(falseResult.env.smtp.secure).toBe(false);
    });

    it('rejects an SMTP_SECURE value other than "true"/"false"', async () => {
      setValidApiEnv({ SMTP_SECURE: 'yes' });

      await expect(importEnv()).rejects.toThrow(/SMTP_SECURE must be "true" or "false"/);
    });
  });

  it('reports every failing field in a single error', async () => {
    setApiEnv({ EMAIL_FROM: 'Buildr <hello@buildr.test>' });

    let caughtError: unknown;
    try {
      await importEnv();
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toMatchObject({
      name: 'EnvValidationError',
    });
    expect(caughtError).toHaveProperty('issues');
  });
});
