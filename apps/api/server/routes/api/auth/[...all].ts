import { defineHandler } from 'nitro';
import { getRequestIP, HTTPError, toRequest } from 'nitro/h3';
import { auth } from '../../../auth/auth.ts';
import { createAuthRequest } from '../../../auth/request.ts';

export default defineHandler(async (event) => {
  try {
    const request = createAuthRequest(toRequest(event.req), getRequestIP(event));
    return await auth.handler(request);
  } catch (error) {
    if (error instanceof Error && error.message === 'AUTH_CLIENT_IP_REQUIRED') {
      throw new HTTPError('AUTH_CLIENT_IP_REQUIRED', { status: 503 });
    }
    throw error;
  }
});
