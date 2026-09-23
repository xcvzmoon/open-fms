import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

type DrizzleAdapterOptions = {
  provider: string;
  schema: { account: unknown; session: unknown; user: unknown; verification: unknown };
};

type EmailVerificationConfig = {
  sendOnSignUp: boolean;
  expiresIn: number;
  sendVerificationEmail: (input: {
    user: { email: string; name: string };
    url: string;
  }) => Promise<void>;
};

type DymoEmailPluginOptions = {
  apiKey: string;
  applyToOAuth: boolean;
  emailRules: { deny: string[] };
};

type EmailOtpPluginOptions = {
  expiresIn: number;
  sendVerificationOTP: (input: { email: string; otp: string; type: string }) => Promise<void>;
};

type FakeDb = { __fake: string };

type CapturedAuthConfig = {
  database: unknown;
  advanced: { database: { generateId: () => string } };
  trustedOrigins: string[];
  basePath: string;
  socialProviders: { google: { clientId: string; clientSecret: string } };
  emailVerification: EmailVerificationConfig;
};

type AuthMockState = { capturedConfig: CapturedAuthConfig | undefined };

const {
  betterAuthMock,
  drizzleAdapterMock,
  dymoEmailPluginMock,
  emailOTPMock,
  sendVerificationEmailMock,
  sendPasswordResetOtpEmailMock,
  authMockState,
} = vi.hoisted(() => {
  const state: AuthMockState = { capturedConfig: undefined };

  return {
    authMockState: state,
    betterAuthMock: vi.fn((config: CapturedAuthConfig) => {
      state.capturedConfig = config;
      return { __mockAuth: true };
    }),
    drizzleAdapterMock: vi.fn((db: FakeDb, options: DrizzleAdapterOptions) => ({ db, options })),
    dymoEmailPluginMock: vi.fn((options: DymoEmailPluginOptions) => ({ id: 'dymo', options })),
    emailOTPMock: vi.fn((options: EmailOtpPluginOptions) => ({ id: 'emailOTP', options })),
    sendVerificationEmailMock: vi.fn(),
    sendPasswordResetOtpEmailMock: vi.fn(),
  };
});

vi.mock('@buildr/database', () => ({
  db: { __fake: 'db' },
  accounts: { __fake: 'accounts' },
  sessions: { __fake: 'sessions' },
  users: { __fake: 'users' },
  verifications: { __fake: 'verifications' },
}));
vi.mock('@dymo-api/better-auth', () => ({ dymoEmailPlugin: dymoEmailPluginMock }));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: drizzleAdapterMock }));
vi.mock('better-auth/minimal', () => ({ betterAuth: betterAuthMock }));
vi.mock('better-auth/plugins', () => ({ emailOTP: emailOTPMock }));
vi.mock('~/server/utils/email.ts', () => ({
  sendVerificationEmail: sendVerificationEmailMock,
  sendPasswordResetOtpEmail: sendPasswordResetOtpEmailMock,
}));
vi.mock('~/server/utils/env.ts', () => ({
  env: {
    web: { origin: 'https://app.buildr.test' },
    google: { client: { id: 'google-client-id', secret: 'google-client-secret' } },
    dymo: { apiKey: 'dymo-api-key' },
  },
}));

afterEach(() => {
  // auth.ts calls betterAuth()/dymoEmailPlugin()/emailOTP() once at module
  // load, so each test needs a fresh module instance to observe a fresh
  // call to those factories.
  vi.resetModules();
  vi.clearAllMocks();
  authMockState.capturedConfig = undefined;
});

/**
 * `apps/api/server/utils/auth.ts` is almost entirely config wiring: it
 * hands `betterAuth()` a plugin/callback tree and lets better-auth,
 * drizzle, and dymo own the rest. Constructing the real `betterAuth()`
 * instance would mean a live Postgres connection and real plugin
 * initialization, so these tests mock every dependency and assert on the
 * config the mock captured instead — including calling the embedded
 * callbacks directly, since that's where this file's own logic actually
 * lives.
 */
async function importAuthAndCaptureConfig(): Promise<CapturedAuthConfig> {
  await import('../../../server/utils/auth.ts');

  const config = authMockState.capturedConfig;
  if (!config) throw new Error('betterAuth() was not called by auth.ts');

  return config;
}

async function importAuthAndCaptureEmailOtpOptions(): Promise<EmailOtpPluginOptions> {
  await import('../../../server/utils/auth.ts');

  const options = emailOTPMock.mock.calls.at(0)?.[0];
  if (!options) throw new Error('emailOTP() was not called by auth.ts');

  return options;
}

describe('auth', () => {
  it('wires the drizzle adapter to the shared database and schema tables', async () => {
    const config = await importAuthAndCaptureConfig();

    expect(drizzleAdapterMock).toHaveBeenCalledExactlyOnceWith(
      { __fake: 'db' },
      {
        provider: 'pg',
        schema: {
          account: { __fake: 'accounts' },
          session: { __fake: 'sessions' },
          user: { __fake: 'users' },
          verification: { __fake: 'verifications' },
        },
      },
    );
    expect(config.database).toEqual({
      db: { __fake: 'db' },
      options: {
        provider: 'pg',
        schema: {
          account: { __fake: 'accounts' },
          session: { __fake: 'sessions' },
          user: { __fake: 'users' },
          verification: { __fake: 'verifications' },
        },
      },
    });
  });

  it('trusts only the configured web origin', async () => {
    const config = await importAuthAndCaptureConfig();

    expect(config.trustedOrigins).toEqual(['https://app.buildr.test']);
  });

  it('scopes every route under /api/v1/auth', async () => {
    const config = await importAuthAndCaptureConfig();

    expect(config.basePath).toBe('/api/v1/auth');
  });

  it('registers Google as a social provider using env credentials', async () => {
    const config = await importAuthAndCaptureConfig();

    expect(config.socialProviders).toEqual({
      google: { clientId: 'google-client-id', clientSecret: 'google-client-secret' },
    });
  });

  it('generates session/user ids as UUID v7', async () => {
    const config = await importAuthAndCaptureConfig();

    const id = config.advanced.database.generateId();

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('denies fraud/invalid/no-reply emails and applies the rule to OAuth too', async () => {
    await importAuthAndCaptureConfig();

    expect(dymoEmailPluginMock).toHaveBeenCalledExactlyOnceWith({
      apiKey: 'dymo-api-key',
      applyToOAuth: true,
      emailRules: { deny: ['FRAUD', 'INVALID', 'NO_REPLY_EMAIL'] },
    });
  });

  describe('emailVerification.sendVerificationEmail', () => {
    it('delegates to sendVerificationEmail with the user email, name, and link', async () => {
      const config = await importAuthAndCaptureConfig();

      expect(config.emailVerification.sendOnSignUp).toBe(true);
      expect(config.emailVerification.expiresIn).toBe(60 * 60);

      await config.emailVerification.sendVerificationEmail({
        user: { email: 'jane@example.com', name: 'Jane Doe' },
        url: 'https://app.buildr.test/verify?token=abc',
      });

      expect(sendVerificationEmailMock).toHaveBeenCalledExactlyOnceWith({
        to: 'jane@example.com',
        name: 'Jane Doe',
        url: 'https://app.buildr.test/verify?token=abc',
      });
    });
  });

  describe('emailOTP plugin', () => {
    it('expires reset codes after 5 minutes', async () => {
      const options = await importAuthAndCaptureEmailOtpOptions();

      expect(options.expiresIn).toBe(5 * 60);
    });

    it('sends the OTP through sendPasswordResetOtpEmail for a forget-password request', async () => {
      const options = await importAuthAndCaptureEmailOtpOptions();

      await options.sendVerificationOTP({
        email: 'jane@example.com',
        otp: '482913',
        type: 'forget-password',
      });

      expect(sendPasswordResetOtpEmailMock).toHaveBeenCalledExactlyOnceWith({
        to: 'jane@example.com',
        otp: '482913',
      });
    });

    it('rejects OTP types other than forget-password instead of silently emailing them', async () => {
      const options = await importAuthAndCaptureEmailOtpOptions();

      await expect(
        options.sendVerificationOTP({ email: 'jane@example.com', otp: '482913', type: 'sign-in' }),
      ).rejects.toThrow('Unsupported email OTP type: sign-in');
      expect(sendPasswordResetOtpEmailMock).not.toHaveBeenCalled();
    });
  });
});
