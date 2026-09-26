import { apiKey } from '@better-auth/api-key';
import { authSchema, db } from '@open-fms/database';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import { resolveAuthEnv } from './env.ts';
import { getMailDispatch } from './mailer.ts';

const env = resolveAuthEnv();

export const auth = betterAuth({
  secret: env.secret,
  baseURL: env.baseURL,
  appName: 'Open FMS',
  basePath: '/api/auth',
  trustedOrigins: env.trustedOrigins,
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
    useSecureCookies: env.isProduction,
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
