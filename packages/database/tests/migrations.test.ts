import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vite-plus/test';

const migrationsDir = join(import.meta.dirname, '..', 'migrations');

function migrationNames(): string[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

function migrationSql(name: string): string {
  return readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8');
}

describe('migration pipeline', () => {
  test('has an init tables migration and a handwritten custom migration', () => {
    const names = migrationNames();
    expect(names).toHaveLength(2);
    expect(names[0]).toMatch(/_init_fms_tables$/);
    expect(names[1]).toMatch(/_fms_partial_indexes_and_checks$/);
  });

  test('every migration ships SQL and a snapshot', () => {
    for (const name of migrationNames()) {
      expect(existsSync(join(migrationsDir, name, 'migration.sql'))).toBe(true);
      expect(existsSync(join(migrationsDir, name, 'snapshot.json'))).toBe(true);
    }
  });

  test('init migration creates the fms schema before tables', () => {
    const sql = migrationSql(migrationNames()[0]);
    expect(sql.startsWith('CREATE SCHEMA IF NOT EXISTS "fms";')).toBe(true);
    expect(sql).toContain('CREATE TABLE "fms"."files"');
  });

  test('handwritten migration adds partial indexes and multi-column checks', () => {
    const sql = migrationSql(migrationNames()[1]);
    expect(sql).toContain('files_caller_idempotency_key_uq');
    expect(sql).toContain('caller_credentials_live_lookup_idx');
    expect(sql).toContain('storage_backends_single_default_idx');
    expect(sql).toContain('files_retain_until_due_idx');
    expect(sql).toContain('files_purge_after_due_idx');
    expect(sql).toContain('files_clean_requires_integrity');
    expect(sql).toContain('caller_usage_counters_non_negative');
    expect(sql).toContain('upload_sessions_part_shape');
  });

  test('handwritten migration stays schema-qualified to fms', () => {
    const sql = migrationSql(migrationNames()[1]);
    expect(sql).not.toMatch(/FROM\s+public\./i);
    expect(sql).toContain('"fms"."');
  });
});
