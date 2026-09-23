import evlog from 'evlog/nitro/v3';
import { defineConfig } from 'nitro';

export default defineConfig({
  compatibilityDate: '2026-08-29',
  serverDir: './server',
  modules: [
    evlog({
      env: {
        service: 'api',
      },
    }),
  ],
});
