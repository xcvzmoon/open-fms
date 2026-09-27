import { defineHandler, defineRouteMeta } from 'nitro';

defineRouteMeta({
  openAPI: {
    tags: ['health'],
    summary: 'Liveness probe',
    description: 'Returns 200 when the process is up. Does not check dependencies.',
    responses: {
      200: {
        description: 'Process is up',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['ok'] },
                uptimeSeconds: { type: 'number' },
              },
              required: ['status', 'uptimeSeconds'],
            },
          },
        },
      },
    },
  },
});

export default defineHandler(() => {
  return {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
  };
});
