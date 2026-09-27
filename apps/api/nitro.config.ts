import { defineConfig } from 'nitro';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  compatibilityDate: '2026-09-26',
  serverDir: './server',
  experimental: {
    tasks: true,
  },
  scheduledTasks: {
    '*/15 * * * *': 'sweep:expired',
    '0 * * * *': 'sweep:purge',
  },
  alias: {
    '~': appRoot,
  },
});
