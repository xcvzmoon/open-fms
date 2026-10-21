import { readdirSync, readFileSync } from 'node:fs';

export function parseAuthFixtureDatabaseUrl(value: string | undefined): URL {
  try {
    if (!value) throw new Error('AUTH_TEST_DATABASE_REQUIRED');
    const url = new URL(value);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !['/audit_test', '/open-fms'].includes(url.pathname) ||
      url.search !== '' ||
      url.hash !== ''
    )
      throw new Error('AUTH_TEST_DATABASE_REQUIRED');
    return url;
  } catch {
    throw new Error('AUTH_TEST_DATABASE_REQUIRED');
  }
}

export function authFixtureMigrationSql(): string {
  const directory = new URL('../migrations/', import.meta.url);
  const names: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) names.push(entry.name);
  }
  return names
    .toSorted()
    .map((name) => readFileSync(new URL(`${name}/migration.sql`, directory), 'utf8'))
    .join('\n');
}
