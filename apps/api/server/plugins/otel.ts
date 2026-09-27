import { definePlugin } from 'nitro';
import { bootstrapOtel } from '~/server/observability/otel.ts';

export default definePlugin(() => {
  void bootstrapOtel().then((shutdown) => {
    process.on('SIGTERM', () => {
      void shutdown();
    });
  });
});
