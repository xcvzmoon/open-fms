import { defineConfig } from 'drizzle-kit';
import * as v from 'valibot';

const dbUrlSchema = v.optional(
  v.pipe(
    v.string('DB_URL must be a string'),
    v.url('DB_URL must be a valid URL'),
    v.regex(/^postgres(?:ql)?:\/\//, 'DB_URL must be a PostgreSQL connection string'),
  ),
);

const dbUrl = v.parse(dbUrlSchema, process.env.DB_URL);

const dbCredentials = dbUrl ? { url: dbUrl } : undefined;

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/tables/index.ts',
  out: 'migrations',
  verbose: true,
  dbCredentials,
  introspect: {
    casing: 'camel',
  },
});
