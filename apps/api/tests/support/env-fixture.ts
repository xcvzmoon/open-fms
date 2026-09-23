import { vi } from 'vite-plus/test';

/**
 * `apps/api/server/utils/env.ts` validates every field of its schema at
 * module load, against `process.env` directly. Any test that imports it (or
 * anything that imports it transitively, like `email.ts` or `auth.ts`) has
 * to supply the full set of required variables up front, or the import
 * itself throws before the test body runs.
 */
const REQUIRED_KEYS = [
  'WEB_ORIGIN',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DYMO_API_KEY',
  'EMAIL_FROM',
] as const;

const OPTIONAL_KEYS = [
  'RESEND_API_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_SECURE',
] as const;

export const API_ENV_KEYS = [...REQUIRED_KEYS, ...OPTIONAL_KEYS];

export const VALID_REQUIRED_API_ENV = {
  WEB_ORIGIN: 'https://app.buildr.test',
  GOOGLE_CLIENT_ID: 'google-client-id',
  GOOGLE_CLIENT_SECRET: 'google-client-secret',
  DYMO_API_KEY: 'dymo-api-key',
  EMAIL_FROM: 'Buildr <hello@buildr.test>',
} satisfies Record<(typeof REQUIRED_KEYS)[number], string>;

/**
 * Stubs every key `env.ts` reads down to exactly the given values via
 * `vi.stubEnv`, clearing (stubbing to `undefined`) everything else in that
 * set first. Deterministic regardless of what the host shell or a local
 * `.env` file happens to have set, which matters most for the "this var is
 * missing" test cases. Callers restore the original environment with
 * `vi.unstubAllEnvs()`.
 */
export function setApiEnv(overrides: Partial<Record<(typeof API_ENV_KEYS)[number], string>>): void {
  for (const key of API_ENV_KEYS) vi.stubEnv(key, overrides[key]);
}

export function setValidApiEnv(
  overrides: Partial<Record<(typeof API_ENV_KEYS)[number], string>> = {},
): void {
  setApiEnv({ ...VALID_REQUIRED_API_ENV, ...overrides });
}
