import { defineMiddleware } from 'nitro';
import { getRequestURL, HTTPError } from 'nitro/h3';
import { auth } from '../auth/auth.ts';

const publicPrefixes = ['/api/auth', '/healthz', '/readyz'];

function isPublicPath(pathname: string): boolean {
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default defineMiddleware(async (event) => {
  const { pathname } = getRequestURL(event);

  if (isPublicPath(pathname) || event.req.method === 'OPTIONS') {
    return;
  }

  const session = await auth.api.getSession({
    headers: event.req.headers,
  });

  if (!session) {
    throw new HTTPError('Authentication required', { status: 401 });
  }

  event.context.session = session.session;
  event.context.user = session.user;
});
