import * as v from 'valibot';
import { describe, expect, test } from 'vite-plus/test';
import { apiKeyPermissionsSchema, storedApiKeyPermissionsSchema } from '../src/auth/permissions.ts';

describe('API key permissions', () => {
  test.each([{ files: ['read'] }, { uploads: ['write'] }, { files: ['read'], uploads: ['write'] }])(
    'accepts explicit grants %j',
    (permissions) => {
      expect(v.parse(apiKeyPermissionsSchema, permissions)).toEqual(permissions);
      expect(v.parse(storedApiKeyPermissionsSchema, JSON.stringify(permissions))).toEqual(
        permissions,
      );
    },
  );

  test.each([
    null,
    {},
    { files: [] },
    { uploads: [] },
    { files: ['write'] },
    { uploads: ['read'] },
    { files: ['read', 'read'] },
    { users: ['read'] },
    { files: ['read'], users: ['read'] },
    { files: 'read' },
  ])('rejects unsupported or empty grants %j', (permissions) => {
    expect(v.safeParse(apiKeyPermissionsSchema, permissions).success).toBe(false);
    expect(v.safeParse(storedApiKeyPermissionsSchema, JSON.stringify(permissions)).success).toBe(
      false,
    );
  });

  test.each([null, '', '{', 'null', '"{\\"files\\":[\\"read\\"]}"'])(
    'rejects malformed stored grants %j',
    (permissions) => {
      expect(v.safeParse(storedApiKeyPermissionsSchema, permissions).success).toBe(false);
    },
  );
});
