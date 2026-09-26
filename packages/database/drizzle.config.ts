import { defineConfig } from 'drizzle-kit';
import { env } from './src/env.ts';

export default defineConfig({
  dialect: 'postgresql',
  schema: '',
  out: 'migrations',
  verbose: true,
  dbCredentials: {
    url: env.db.url,
  },
  introspect: {
    casing: 'camel',
  },
});
