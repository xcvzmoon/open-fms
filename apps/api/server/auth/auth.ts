import { apiKey } from '@better-auth/api-key';
import { authSchema, db } from '@open-fms/database';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { getMailDispatch } from './mailer.ts';

type AuthBootstrapConfig = {
  secret?: string | undefined;
  baseURL?: string | undefined;
};

function readAuthConfig(): AuthBootstrapConfig {
  const config: AuthBootstrapConfig = {};
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (secret) {
    config.secret = secret;
  }
  if (baseURL) {
    config.baseURL = baseURL;
  }
  return config;
}

export const auth = betterAuth({
  ...readAuthConfig(),
  appName: 'Open FMS',
  basePath: '/api/auth',
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: true,
    async sendResetPassword({ user, url }) {
      const mail = getMailDispatch();
      await mail.notify({
        type: 'auth.password-reset',
        email: user.email,
        resetUrl: url,
      });
    },
  },
  emailVerification: {
    async sendVerificationEmail({ user, url }) {
      const mail = getMailDispatch();
      if (process.env.NODE_ENV !== 'production') {
        console.info('[auth] verification link for %s: %s', user.email, url);
      }
      await mail.notify({
        type: 'auth.verify',
        email: user.email,
        verifyUrl: url,
      });
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: {
      enabled: true,
      maxAge: 300,
      strategy: 'compact',
    },
  },
  rateLimit: {
    enabled: true,
    window: 10,
    max: 100,
    storage: 'database',
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
    },
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === 'production',
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'],
    },
  },
  plugins: [
    bearer(),
    apiKey({
      enableSessionForAPIKeys: true,
      apiKeyHeaders: ['x-api-key', 'authorization'],
    }),
  ],
});

export type Session = typeof auth.$Infer.Session;
