import { pingDatabase } from '@open-fms/database';
import { defineHandler, defineRouteMeta } from 'nitro';
import { HTTPError } from 'nitro/h3';

type HealthCheck = {
  status: 'ok' | 'error';
  detail?: string;
};

defineRouteMeta({
  openAPI: {
    tags: ['health'],
    summary: 'Readiness probe',
    description:
      'Returns 200 only when PostgreSQL is reachable. Each dependency is reported separately.',
    responses: {
      200: {
        description: 'Ready to serve traffic',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['ready'] },
                checks: { type: 'object', additionalProperties: true },
              },
              required: ['status', 'checks'],
            },
          },
        },
      },
      503: {
        description: 'One or more dependencies are unavailable',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                statusCode: { type: 'number' },
                statusMessage: { type: 'string' },
                data: { type: 'object', additionalProperties: true },
              },
            },
          },
        },
      },
    },
  },
});

export default defineHandler(async () => {
  const processCheck: HealthCheck = { status: 'ok' };
  let postgresCheck: HealthCheck = { status: 'ok' };
  try {
    await pingDatabase();
  } catch (error) {
    postgresCheck = {
      status: 'error',
      detail: error instanceof Error ? error.message : 'postgres_unavailable',
    };
  }

  const checks = {
    process: processCheck,
    postgres: postgresCheck,
  };

  if (processCheck.status === 'error' || postgresCheck.status === 'error') {
    throw new HTTPError('NOT_READY', {
      status: 503,
      data: { checks },
    });
  }

  return { status: 'ready', checks };
});
