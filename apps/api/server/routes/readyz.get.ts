import { pingDatabase } from '@open-fms/database';
import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';

type HealthCheck = {
  status: 'ok' | 'error';
  detail?: string;
};

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
