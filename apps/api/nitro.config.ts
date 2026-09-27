import { defineConfig } from 'nitro';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  compatibilityDate: '2026-09-26',
  serverDir: './server',
  experimental: {
    tasks: true,
    openAPI: true,
  },
  openAPI: {
    meta: {
      title: 'Open FMS API',
      description: 'File management API for S3-compatible storage',
      version: '0.0.5',
    },
    ui: {
      scalar: {
        route: '/_scalar',
      },
      swagger: false,
    },
  },
  scheduledTasks: {
    '*/15 * * * *': 'sweep-expired',
    '0 * * * *': 'sweep-purge',
    '0 2 * * *': 'sweep-reconcile',
    '*/5 * * * *': 'observability-canary',
  },
  alias: {
    '~': appRoot,
  },
});
