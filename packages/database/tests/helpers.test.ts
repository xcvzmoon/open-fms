import { getTableColumns } from 'drizzle-orm';
import { pgTable, uuid } from 'drizzle-orm/pg-core';
import { describe, expect, test } from 'vite-plus/test';
import {
  generateTimestamps,
  generateTimestampsWithAudit,
  generateUuid,
  TIMESTAMP_CONFIG,
} from '../src/helpers/index.ts';

describe('generateUuid', () => {
  test('creates a primary key column named id', () => {
    const table = pgTable('generate_uuid_named', {
      id: generateUuid('id'),
    });
    const column = getTableColumns(table).id;

    expect(column.name).toBe('id');
    expect(column.primary).toBe(true);
  });

  test('defaults the column name to id', () => {
    const table = pgTable('generate_uuid_unnamed', {
      id: generateUuid(),
    });
    expect(getTableColumns(table).id.name).toBe('id');
  });

  test('defaults to a version 7 uuid generated in code', () => {
    const table = pgTable('generate_uuid_default', {
      id: generateUuid('id'),
    });
    const column = getTableColumns(table).id;

    expect(column.hasDefault).toBe(true);
    expect(column.default).toBeUndefined();

    const generated = column.defaultFn?.();
    expect(generated).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('TIMESTAMP_CONFIG', () => {
  test('uses timestamptz(3) date mode', () => {
    expect(TIMESTAMP_CONFIG).toEqual({
      mode: 'date',
      precision: 3,
      withTimezone: true,
    });
  });
});

describe('generateTimestamps', () => {
  test('adds created, updated, and soft-delete timestamps', () => {
    const table = pgTable('generate_timestamps_probe', {
      id: generateUuid('id'),
      ...generateTimestamps(),
    });
    const columns = getTableColumns(table);

    expect(Object.keys(columns).toSorted()).toEqual(['createdAt', 'deletedAt', 'id', 'updatedAt']);
    expect(columns.createdAt.hasDefault).toBe(true);
    expect(columns.updatedAt.hasDefault).toBe(true);
    expect(columns.deletedAt.notNull).toBe(false);
  });
});

describe('generateTimestampsWithAudit', () => {
  test('adds actor columns without foreign keys by default', () => {
    const table = pgTable('generate_timestamps_audit_probe', {
      id: generateUuid('id'),
      ...generateTimestampsWithAudit(),
    });
    const columns = getTableColumns(table);

    expect(Object.keys(columns).toSorted()).toEqual([
      'createdAt',
      'createdBy',
      'deletedAt',
      'deletedBy',
      'id',
      'updatedAt',
      'updatedBy',
    ]);
    expect(columns.createdBy.notNull).toBe(true);
    expect(columns.updatedBy.notNull).toBe(false);
    expect(columns.deletedBy.notNull).toBe(false);
  });

  test('keeps actor columns when userId is provided', () => {
    const users = pgTable('users_probe', {
      id: uuid('id').primaryKey(),
    });
    const table = pgTable('generate_timestamps_audit_fk_probe', {
      id: generateUuid('id'),
      ...generateTimestampsWithAudit({
        userId: () => users.id,
        createdByOnDelete: 'cascade',
      }),
    });
    const columns = getTableColumns(table);

    expect(Object.keys(columns).toSorted()).toEqual([
      'createdAt',
      'createdBy',
      'deletedAt',
      'deletedBy',
      'id',
      'updatedAt',
      'updatedBy',
    ]);
    expect(columns.createdBy.notNull).toBe(true);
  });
});
