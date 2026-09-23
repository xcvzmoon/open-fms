import { mockEvent } from 'h3';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

const { authHandlerMock } = vi.hoisted(() => ({
  authHandlerMock: vi.fn<(request: Request) => Promise<Response>>(),
}));

vi.mock('~/server/utils/auth.ts', () => ({ auth: { handler: authHandlerMock } }));

afterEach(() => {
  vi.resetModules();
  authHandlerMock.mockReset();
});

async function importHandler() {
  return (await import('../../../../../server/api/v1/auth/[...all].ts')).default;
}

describe('auth catch-all route', () => {
  it("delegates the raw request to better-auth's handler", async () => {
    const handler = await importHandler();
    const response = new Response('ok', { status: 200 });
    authHandlerMock.mockResolvedValue(response);

    const event = mockEvent('http://localhost/api/v1/auth/sign-in', { method: 'POST' });
    const result = await handler(event);

    expect(authHandlerMock).toHaveBeenCalledExactlyOnceWith(event.req);
    expect(result).toBe(response);
  });

  it('returns whatever better-auth responds with, unmodified', async () => {
    const handler = await importHandler();
    const response = new Response(JSON.stringify({ user: { id: 'user_1' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    authHandlerMock.mockResolvedValue(response);

    const result = await handler(mockEvent('http://localhost/api/v1/auth/get-session'));

    expect(result).toBe(response);
  });
});
