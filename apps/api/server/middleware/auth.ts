import { defineHandler, HTTPError } from 'nitro';
import { auth } from '~/server/utils/auth.ts';

const PUBLIC_API_PREFIX = '/api/v1/auth';

export default defineHandler(async (event) => {
  const { pathname } = event.url;
  if (!pathname.startsWith('/api') || pathname.startsWith(PUBLIC_API_PREFIX)) return;

  const session = await auth.api.getSession({ headers: event.req.headers });
  if (!session) throw HTTPError.status(401, 'Unauthorized');

  event.context.session = session.session;
  event.context.user = session.user;
});
