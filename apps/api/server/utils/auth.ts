import { accounts, db, sessions, users, verifications } from '@buildr/database';
import { dymoEmailPlugin } from '@dymo-api/better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { emailOTP } from 'better-auth/plugins';
import { v7 as uuidV7 } from 'uuid';
import { sendPasswordResetOtpEmail, sendVerificationEmail } from '~/server/utils/email.ts';
import { env } from '~/server/utils/env.ts';

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

declare module 'h3' {
  interface H3EventContext {
    session?: AuthSession['session'];
    user?: AuthSession['user'];
  }
}

const EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;
const RESET_PASSWORD_OTP_EXPIRES_IN_SECONDS = 5 * 60;

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      account: accounts,
      session: sessions,
      user: users,
      verification: verifications,
    },
  }),
  advanced: {
    database: {
      generateId: () => uuidV7(),
    },
  },
  trustedOrigins: [env.web.origin],
  emailAndPassword: {
    enabled: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    expiresIn: EMAIL_VERIFICATION_EXPIRES_IN_SECONDS,
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({ to: user.email, name: user.name, url });
    },
  },
  socialProviders: {
    google: {
      clientId: env.google.client.id,
      clientSecret: env.google.client.secret,
    },
  },
  plugins: [
    dymoEmailPlugin({
      apiKey: env.dymo.apiKey,
      applyToOAuth: true,
      emailRules: { deny: ['FRAUD', 'INVALID', 'NO_REPLY_EMAIL'] },
    }),
    emailOTP({
      expiresIn: RESET_PASSWORD_OTP_EXPIRES_IN_SECONDS,
      sendVerificationOTP: async ({ email, otp, type }) => {
        if (type !== 'forget-password') {
          throw new Error(`Unsupported email OTP type: ${type}`);
        }

        await sendPasswordResetOtpEmail({ to: email, otp });
      },
    }),
  ],
  basePath: '/api/v1/auth',
});
