import { mockEvent } from 'h3';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

type AuthSessionLike = { session: unknown; user: unknown } | null;

const { getSessionMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn<(input: { headers: Headers }) => Promise<AuthSessionLike>>(),
}));

vi.mock('~/server/utils/auth.ts', () => ({ auth: { api: { getSession: getSessionMock } } }));

afterEach(() => {
  vi.resetModules();
  getSessionMock.mockReset();
});

async function importMiddleware() {
  return (await import('../../../server/middleware/auth.ts')).default;
}

describe('server auth middleware', () => {
  it('skips authentication entirely for non-API routes', async () => {
    const middleware = await importMiddleware();

    await expect(middleware(mockEvent('http://localhost/healthz'))).resolves.toBeUndefined();

    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('does not gate the public auth routes', async () => {
    const middleware = await importMiddleware();

    await expect(
      middleware(mockEvent('http://localhost/api/v1/auth/sign-in')),
    ).resolves.toBeUndefined();

    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated request to a protected API route', async () => {
    const middleware = await importMiddleware();
    getSessionMock.mockResolvedValue(null);

    await expect(middleware(mockEvent('http://localhost/api/v1/users/me'))).rejects.toMatchObject({
      status: 401,
    });
  });

  it('attaches the session and user to the event context on success', async () => {
    const middleware = await importMiddleware();
    const session = { id: 'session_1', userId: 'user_1' };
    const user = { id: 'user_1', email: 'jane@example.com' };
    getSessionMock.mockResolvedValue({ session, user });
    const event = mockEvent('http://localhost/api/v1/users/me');

    await expect(middleware(event)).resolves.toBeUndefined();

    expect(event.context.session).toBe(session);
    expect(event.context.user).toBe(user);
  });

  it('forwards the incoming request headers to auth.api.getSession', async () => {
    const middleware = await importMiddleware();
    getSessionMock.mockResolvedValue({ session: {}, user: {} });

    const event = mockEvent('http://localhost/api/v1/users/me', {
      headers: { cookie: 'better-auth.session_token=abc123' },
    });
    await middleware(event);

    const call = getSessionMock.mock.calls.at(0)?.[0];
    if (!call) throw new Error('auth.api.getSession was not called');
    expect(call.headers.get('cookie')).toBe('better-auth.session_token=abc123');
  });
});
