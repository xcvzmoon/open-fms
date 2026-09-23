import { defineConfig } from 'drizzle-kit';
import { env } from './src/env.ts';

export default defineConfig({
  dialect: 'postgresql',
  dbCredentials: {
    url: env.db.url,
  },
  introspect: {
    casing: 'camel',
  },
  out: './src/migrations/',
  schema: './src/schema.ts',
  verbose: true,
});
