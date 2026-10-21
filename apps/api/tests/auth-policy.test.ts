import type { CallerContext } from '@open-fms/database';
import { describe, expect, test } from 'vite-plus/test';
import {
  applyCredentialPolicy,
  cidrAllows,
  isTrustedMutation,
  requiredPermissions,
  smallerLimit,
} from '../server/auth/policy.ts';

function callerContext(): CallerContext {
  return {
    caller: {
      id: 'caller',
      name: 'app',
      kind: 'app',
      status: 'active',
      maxFileSizeBytes: 100,
      allowedContentTypes: ['image/png'],
      quotaBytes: null,
      rateLimitPerSec: 10,
      retentionDays: null,
    },
    credential: {
      keyId: 'key',
      kind: 'restricted',
      allowedCidrs: ['192.0.2.0/24'],
      allowedTypes: ['image/png'],
      maxFileSizeBytes: 50,
      rateLimitPerSec: 4,
    },
  };
}

describe('resource credential boundary', () => {
  test('narrows size, types and rate without expanding caller policy', () => {
    const context = callerContext();
    expect(applyCredentialPolicy(context, { uploads: ['write'] }, '192.0.2.4')).toBe(true);
    expect(context.caller.maxFileSizeBytes).toBe(50);
    expect(context.caller.allowedContentTypes).toEqual(['image/png']);
    expect(context.caller.rateLimitPerSec).toBe(4);
  });
  test('denies empty restricted types and disjoint policies', () => {
    const context = callerContext();
    expect(applyCredentialPolicy(context, { files: ['read'] }, '192.0.2.4')).toBe(true);
    if (!context.credential) throw new Error('TEST_CREDENTIAL_REQUIRED');
    context.credential.allowedTypes = [];
    expect(applyCredentialPolicy(context, { uploads: ['write'] }, '192.0.2.4')).toBe(false);
    context.credential.allowedTypes = ['text/plain'];
    expect(applyCredentialPolicy(context, { uploads: ['write'] }, '192.0.2.4')).toBe(false);
  });
  test('validates IPv4 and IPv6 through Node subnet rules and fails closed', () => {
    expect(cidrAllows('192.0.2.4', ['192.0.2.0/24'])).toBe(true);
    expect(cidrAllows('192.0.3.4', ['192.0.2.0/24'])).toBe(false);
    expect(cidrAllows('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(cidrAllows('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(cidrAllows('192.0.2.4', ['192.0.2.0/999'])).toBe(false);
    expect(cidrAllows('', ['192.0.2.0/24'])).toBe(false);
    expect(cidrAllows('192.0.2.4', ['garbage', '192.0.2.0/24'])).toBe(false);
  });
  test('maps every upload mutation and file read to a permission', () => {
    expect(requiredPermissions('/api/v1/uploads/abc/parts/1', 'PUT')).toEqual({
      uploads: ['write'],
    });
    expect(requiredPermissions('/api/v1/uploads/abc', 'GET')).toEqual({ files: ['read'] });
    expect(requiredPermissions('/api/v1/files/abc/content', 'GET')).toEqual({ files: ['read'] });
    expect(requiredPermissions('/api/v1/uploads/abc', 'HEAD')).toEqual({ files: ['read'] });
    expect(requiredPermissions('/api/v1/signup', 'POST')).toBeNull();
    expect(requiredPermissions('/api/v1/uploads-other', 'POST')).toBeNull();
    expect(smallerLimit(null, 3)).toBe(3);
    expect(smallerLimit(2, null)).toBe(2);
    expect(smallerLimit(2, 8)).toBe(2);
  });
});

describe('custom cookie mutation origins', () => {
  test('rejects missing, null and foreign origins', () => {
    for (const origin of ['', 'null', 'https://attacker.example']) {
      const headers = new Headers();
      if (origin) headers.set('origin', origin);
      expect(isTrustedMutation(headers, 'POST', ['https://fms.example/path'])).toBe(false);
    }
    expect(
      isTrustedMutation(new Headers({ origin: 'https://fms.example' }), 'POST', [
        'https://fms.example/path',
      ]),
    ).toBe(true);
    expect(isTrustedMutation(new Headers(), 'GET', ['https://fms.example'])).toBe(true);
  });
});

describe('pepper version configuration', () => {
  test('rejects partial numbers, zero, overflow and fractional versions', async () => {
    const { resolveAuthEnv } = await import('../server/auth/env.ts');
    for (const version of ['2abc', '0', '32768', '1.5', '1e2']) {
      expect(() =>
        resolveAuthEnv({
          BETTER_AUTH_SECRET: 'x'.repeat(32),
          BETTER_AUTH_URL: 'https://fms.example',
          AUTH_TOKEN_PEPPER_VERSION: version,
        }),
      ).toThrow('AUTH_TOKEN_PEPPER_VERSION_INVALID');
    }
  });
});
