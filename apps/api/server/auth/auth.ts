import type { MailDispatch } from '@open-fms/mailer';
import type { Auth, BetterAuthOptions } from 'better-auth';
import { apiKey } from '@better-auth/api-key';
import { assertSignupAllowed, authSchema, db } from '@open-fms/database';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { resolveAuthEnv } from './env.ts';
import { getMailDispatch } from './mailer.ts';
import { clientIpHeader } from './request.ts';

type FmsAuthOptions = BetterAuthOptions & { plugins: [ReturnType<typeof apiKey>] };
export type FmsAuth = Auth<FmsAuthOptions>;

export function createAuth(
  bootstrapEmail?: string,
  mailDispatch: MailDispatch = getMailDispatch(),
): FmsAuth {
  const env = resolveAuthEnv();
  const permittedEmail =
    bootstrapEmail === undefined ? undefined : bootstrapEmail.trim().toLowerCase();
  return betterAuth<FmsAuthOptions>({
    secret: env.secret,
    baseURL: env.baseURL,
    appName: 'Open FMS',
    basePath: '/api/auth',
    trustedOrigins: env.trustedOrigins,
    disabledPaths: ['/api-key/create', '/api-key/update', '/api-key/delete'],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: authSchema,
    }),
    databaseHooks: {
      user: {
        create: {
          async before(user) {
            try {
              if (permittedEmail === undefined || user.email.toLowerCase() !== permittedEmail)
                await assertSignupAllowed(user.email);
            } catch {
              throw new APIError('FORBIDDEN', { message: 'SIGNUP_NOT_ALLOWED' });
            }
            return { data: user };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await mailDispatch.notify({
          type: 'auth.password-reset',
          email: user.email,
          resetUrl: url,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      async sendVerificationEmail({ user, url }) {
        await mailDispatch.notify({
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
        enabled: false,
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
        ipAddressHeaders: [clientIpHeader],
      },
    },
    plugins: [
      apiKey({
        enableSessionForAPIKeys: false,
        deferUpdates: false,
        apiKeyHeaders: ['x-api-key'],
      }),
    ],
  });
}

export const auth: FmsAuth = createAuth();

export type Session = typeof auth.$Infer.Session;
