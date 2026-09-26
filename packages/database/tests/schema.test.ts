import { getTableColumns } from 'drizzle-orm';
import { expect, test } from 'vite-plus/test';
import { generateUuid } from '../src/helpers/index.ts';
import { fmsSchema } from '../src/schema.ts';

test('fmsSchema is the named fms schema', () => {
  expect(fmsSchema.schemaName).toBe('fms');
});

test('fmsSchema tables are created inside the fms schema', () => {
  const table = fmsSchema.table('schema_probe', {
    id: generateUuid('id'),
  });

  expect(Object.keys(getTableColumns(table))).toEqual(['id']);
});
