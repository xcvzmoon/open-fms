import { consumeCallerRateLimit, loadCallerContext } from '@open-fms/database';
import { defineMiddleware } from 'nitro';
import { getRequestIP, getRequestURL, HTTPError } from 'nitro/h3';
import { auth } from '../auth/auth.ts';
import { resolveAuthEnv } from '../auth/env.ts';
import { applyCredentialPolicy, isTrustedMutation, requiredPermissions } from '../auth/policy.ts';
import { isPublicRequest } from '../auth/public-paths.ts';

export default defineMiddleware(async (event) => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(getRequestURL(event).pathname).replace(/\/{2,}/g, '/');
  } catch {
    throw new HTTPError('REQUEST_PATH_INVALID', { status: 400 });
  }
  if (isPublicRequest(pathname, event.req.method)) return;
  const headers = event.req.headers;
  const key = headers.get('x-api-key');
  const adminRoute =
    pathname.startsWith('/api/v1/admin/') || pathname.startsWith('/api/v1/callers/');
  const signupRoute = pathname === '/api/v1/signup' || pathname.startsWith('/api/v1/signup/');
  if (key) {
    if (adminRoute || signupRoute) throw new HTTPError('ADMIN_SESSION_REQUIRED', { status: 403 });
    const permissions = requiredPermissions(pathname, event.req.method);
    const verified = await auth.api.verifyApiKey({
      body: { key, permissions: permissions ?? undefined },
    });
    if (!verified.valid || !verified.key) throw new HTTPError('AUTH_REQUIRED', { status: 401 });
    const caller = await loadCallerContext(verified.key.referenceId, verified.key.id);
    if (!caller?.credential) throw new HTTPError('CALLER_CREDENTIAL_DENIED', { status: 403 });
    if (!applyCredentialPolicy(caller, permissions, getRequestIP(event) ?? ''))
      throw new HTTPError('CREDENTIAL_POLICY_DENIED', { status: 403 });
    if (!(await consumeCallerRateLimit(caller.caller.id, caller.caller.rateLimitPerSec)))
      throw new HTTPError('CALLER_RATE_LIMIT', { status: 429 });
    event.context.caller = caller;
    return;
  }
  const session = await auth.api.getSession({ headers, query: { disableCookieCache: true } });
  if (!session || !session.user.emailVerified)
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  if (!isTrustedMutation(headers, event.req.method, resolveAuthEnv().trustedOrigins))
    throw new HTTPError('ORIGIN_DENIED', { status: 403 });
  event.context.session = session.session;
  event.context.user = session.user;
  if (signupRoute) return;
  const caller = await loadCallerContext(session.user.id);
  if (!caller) throw new HTTPError('CALLER_INACTIVE', { status: 403 });
  if (adminRoute && caller.caller.kind !== 'admin')
    throw new HTTPError('ADMIN_REQUIRED', { status: 403 });
  if (!(await consumeCallerRateLimit(caller.caller.id, caller.caller.rateLimitPerSec)))
    throw new HTTPError('CALLER_RATE_LIMIT', { status: 429 });
  event.context.caller = caller;
});
