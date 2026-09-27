import { defineTask } from 'nitro/task';
import { runProcessCanary } from '~/server/observability/canary.ts';

export default defineTask({
  meta: {
    name: 'observability-canary',
    description: 'Run the scheduled process canary',
  },
  run() {
    return { result: runProcessCanary() };
  },
});
