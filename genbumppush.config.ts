import { defineConfig } from 'genbumppush';

export default defineConfig({
  release: 'patch',
  hooks: {
    before: ['vp run check', 'vp run typecheck', 'vp run test'],
  },
  github: {
    enabled: true,
  },
});
