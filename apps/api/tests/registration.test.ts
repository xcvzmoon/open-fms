import { describe, expect, test } from 'vite-plus/test';
import { resolveAuthEnv } from '../server/auth/env.ts';

describe('resolveAuthEnv pepper', () => {
  test('derives pepper from dedicated secret and version', () => {
    const env = resolveAuthEnv({
      BETTER_AUTH_SECRET: 'x'.repeat(32),
      BETTER_AUTH_URL: 'https://fms.example',
      AUTH_TOKEN_PEPPER: 'y'.repeat(32),
      AUTH_TOKEN_PEPPER_VERSION: '2',
    });
    expect(env.pepperSecret).toBe('y'.repeat(32));
    expect(env.pepperVersion).toBe(2);
  });

  test('rejects a non-numeric pepper version', () => {
    expect(() =>
      resolveAuthEnv({
        BETTER_AUTH_SECRET: 'x'.repeat(32),
        BETTER_AUTH_URL: 'https://fms.example',
        AUTH_TOKEN_PEPPER_VERSION: 'abc',
      }),
    ).toThrow(/AUTH_TOKEN_PEPPER_VERSION_INVALID/);
  });
});
