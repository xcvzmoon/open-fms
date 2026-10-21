import { describe, expect, test } from 'vite-plus/test';
import { authFixtureMigrationSql, parseAuthFixtureDatabaseUrl } from './auth-fixture.ts';

describe('auth fixture database admission', () => {
  test.each([
    'postgres://fixture:dummy@127.0.0.1:5432/open-fms',
    'postgresql://fixture@localhost:62179/audit_test',
    'postgres://fixture@[::1]:5432/open-fms',
  ])('accepts an approved loopback fixture', (value) => {
    expect(parseAuthFixtureDatabaseUrl(value).toString()).toBe(value);
  });
  test.each([
    undefined,
    '',
    'invalid',
    'https://localhost/open-fms',
    'postgres://fixture:dummy@db.example/audit_test',
    'postgres://fixture@localhost.example/audit_test',
    'postgres://fixture@127.0.0.1/production',
    'postgres://fixture@127.0.0.1/open-fms?host=db.example',
    'postgres://fixture@127.0.0.1/open-fms#other',
  ])('rejects unsafe configuration with a credential-free error', (value) => {
    expect(() => parseAuthFixtureDatabaseUrl(value)).toThrow(/^AUTH_TEST_DATABASE_REQUIRED$/);
  });
  test('loads the shipped migration pipeline in order', () => {
    const sql = authFixtureMigrationSql();
    expect(sql.indexOf('CREATE SCHEMA IF NOT EXISTS "fms"')).toBe(0);
    const createUploadPasses = sql.indexOf('CREATE TABLE "fms"."upload_passes"');
    const dropUploadPasses = sql.indexOf('DROP TABLE "fms"."upload_passes"');
    expect(createUploadPasses).toBeGreaterThan(0);
    expect(dropUploadPasses).toBeGreaterThan(createUploadPasses);
    expect(sql).toContain('CREATE TABLE "fms"."auth_rate_limits"');
  });
});
