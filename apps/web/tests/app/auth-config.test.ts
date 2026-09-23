import { describe, expect, it } from 'vite-plus/test';

type ProbedClient = {
  signIn: unknown;
  signOut: unknown;
  useSession: unknown;
  emailOtp?: {
    sendVerificationOtp: unknown;
    resetPassword: unknown;
  };
};

/**
 * `@nuxtjs/better-auth`'s `defineClientAuth` returns a factory that builds
 * a real (proxy-based) better-auth client, so there's nothing to inspect
 * via `Object.keys` — every method is a proxy trap, not an own property.
 * Mocking `better-auth/vue` from here doesn't reach the client either:
 * Vitest only intercepts modules resolved directly from the file under
 * test, not ones a third-party dependency (`@nuxtjs/better-auth`) imports
 * internally. So this asserts on the one thing that's actually observable
 * from the outside — the client exposes the methods the configured plugin
 * and base auth client are supposed to add.
 */
async function buildClient(baseURL: string): Promise<ProbedClient> {
  const { default: buildClientAuth } = await import('../../app/auth.config.ts');
  return buildClientAuth(baseURL);
}

describe('auth.config (defineClientAuth)', () => {
  it('builds a real better-auth client without throwing', async () => {
    await expect(buildClient('https://app.buildr.test')).resolves.toBeTruthy();
  });

  it('exposes the base auth client surface', async () => {
    const client = await buildClient('https://app.buildr.test');

    expect(client.signIn).toBeInstanceOf(Function);
    expect(client.signOut).toBeInstanceOf(Function);
    expect(client.useSession).toBeInstanceOf(Function);
  });

  it('wires the email OTP plugin in', async () => {
    const client = await buildClient('https://app.buildr.test');

    expect(client.emailOtp?.sendVerificationOtp).toBeInstanceOf(Function);
    expect(client.emailOtp?.resetPassword).toBeInstanceOf(Function);
  });
});
