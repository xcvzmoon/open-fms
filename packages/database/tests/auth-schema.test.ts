import { getTableColumns, getTableSchema } from 'drizzle-orm';
import { describe, expect, test } from 'vite-plus/test';
import {
  authAccounts,
  authApiKeys,
  authSchema,
  authSessions,
  authUsers,
  authVerifications,
} from '../src/auth/schema.ts';

describe('better auth schema', () => {
  test('auth tables live in the fms schema', () => {
    const tables = [authUsers, authSessions, authAccounts, authVerifications, authApiKeys];
    for (const table of tables) {
      expect(getTableSchema(table)).toBe('fms');
    }
  });

  test('authSchema maps Better Auth model names', () => {
    expect(Object.keys(authSchema).toSorted()).toEqual([
      'account',
      'apikey',
      'session',
      'user',
      'verification',
    ]);
    expect(authSchema.user).toBe(authUsers);
    expect(authSchema.apikey).toBe(authApiKeys);
  });

  test('api keys store hashed material and rate limit fields', () => {
    const columns = getTableColumns(authApiKeys);
    expect(Object.keys(columns)).toEqual(
      expect.arrayContaining([
        'key',
        'referenceId',
        'enabled',
        'rateLimitEnabled',
        'rateLimitMax',
        'expiresAt',
        'metadata',
      ]),
    );
  });
});
