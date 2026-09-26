import { describe, expect, test } from 'vite-plus/test';
import { resolveAuthEnv } from '../server/auth/env.ts';
import { resolveMailerEnv } from '../server/auth/mailer.ts';
import { isPublicRequest } from '../server/auth/public-paths.ts';

const validAuthEnv = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://fms.example',
};

describe('resolveAuthEnv', () => {
  test('accepts a long secret and url', () => {
    const env = resolveAuthEnv(validAuthEnv);
    expect(env.baseURL).toBe('https://fms.example');
    expect(env.trustedOrigins).toEqual(['https://fms.example']);
    expect(env.isProduction).toBe(false);
  });

  test('rejects a short secret with a stable code', () => {
    expect(() => resolveAuthEnv({ ...validAuthEnv, BETTER_AUTH_SECRET: 'short' })).toThrow(
      /AUTH_ENV_INVALID: AUTH_ENV_SECRET_TOO_SHORT/,
    );
  });

  test('rejects a missing url with a stable code', () => {
    expect(() => resolveAuthEnv({ BETTER_AUTH_SECRET: validAuthEnv.BETTER_AUTH_SECRET })).toThrow(
      /AUTH_ENV_INVALID: AUTH_ENV_URL_REQUIRED/,
    );
  });

  test('includes public app url in trusted origins', () => {
    const env = resolveAuthEnv({ ...validAuthEnv, PUBLIC_APP_URL: 'https://app.example' });
    expect(env.trustedOrigins).toEqual(['https://fms.example', 'https://app.example']);
  });
});

describe('resolveMailerEnv', () => {
  test('defaults to mock transport', () => {
    const env = resolveMailerEnv({});
    expect(env.mode).toBe('mock');
  });

  test('maps smtp mode and port', () => {
    const env = resolveMailerEnv({
      MAIL_MODE: 'smtp',
      SMTP_HOST: 'mailpit',
      SMTP_PORT: '1025',
    });
    expect(env.mode).toBe('smtp');
    expect(env.smtpHost).toBe('mailpit');
    expect(env.smtpPort).toBe(1025);
  });

  test('rejects an invalid mail mode with a stable code', () => {
    expect(() => resolveMailerEnv({ MAIL_MODE: 'sendgrid' })).toThrow(
      /MAIL_ENV_INVALID: MAIL_ENV_MODE_INVALID/,
    );
  });
});

describe('isPublicRequest', () => {
  test('allows auth, signup, health, and options', () => {
    expect(isPublicRequest('/api/auth/sign-in/email', 'POST')).toBe(true);
    expect(isPublicRequest('/api/v1/signup', 'POST')).toBe(true);
    expect(isPublicRequest('/api/v1/signup/redeem', 'POST')).toBe(true);
    expect(isPublicRequest('/healthz', 'GET')).toBe(true);
    expect(isPublicRequest('/readyz', 'GET')).toBe(true);
    expect(isPublicRequest('/api/me', 'OPTIONS')).toBe(true);
  });

  test('requires auth for api routes', () => {
    expect(isPublicRequest('/api/me', 'GET')).toBe(false);
    expect(isPublicRequest('/api', 'GET')).toBe(false);
  });
});
