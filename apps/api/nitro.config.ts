import { defineConfig } from 'nitro';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  compatibilityDate: '2026-09-26',
  serverDir: './server',
  alias: {
    '~': appRoot,
  },
});
