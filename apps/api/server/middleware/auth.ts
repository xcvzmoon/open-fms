import { loadCallerContext } from '@open-fms/database';
import { defineMiddleware } from 'nitro';
import { getRequestURL, HTTPError } from 'nitro/h3';
import { auth } from '../auth/auth.ts';
import { isPublicRequest } from '../auth/public-paths.ts';

export default defineMiddleware(async (event) => {
  const { pathname } = getRequestURL(event);

  if (isPublicRequest(pathname, event.req.method)) {
    return;
  }

  const session = await auth.api.getSession({
    headers: event.req.headers,
  });

  if (!session) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }

  event.context.session = session.session;
  event.context.user = session.user;

  const caller = await loadCallerContext(session.user.id);
  if (caller) {
    event.context.caller = caller;
  }
});
