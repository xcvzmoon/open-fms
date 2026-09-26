import * as v from 'valibot';

export type AuthEnv = {
  secret: string;
  baseURL: string;
  isProduction: boolean;
  trustedOrigins: string[];
};

const secretSchema = v.pipe(
  v.string('AUTH_ENV_SECRET_REQUIRED'),
  v.minLength(32, 'AUTH_ENV_SECRET_TOO_SHORT'),
);

const baseUrlSchema = v.pipe(v.string('AUTH_ENV_URL_REQUIRED'), v.url('AUTH_ENV_URL_INVALID'));

const publicAppUrlSchema = v.optional(
  v.pipe(v.string('AUTH_ENV_PUBLIC_URL_INVALID'), v.url('AUTH_ENV_PUBLIC_URL_INVALID')),
);

function collectIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  const messages: string[] = [];
  for (const issue of issues) {
    messages.push(issue.message);
  }
  return messages.join('; ');
}

function parseRequired(
  schema: typeof secretSchema | typeof baseUrlSchema,
  input: string | undefined,
): string {
  const parsed = v.safeParse(schema, input);
  if (!parsed.success) {
    throw new Error(`AUTH_ENV_INVALID: ${collectIssues(parsed.issues)}`);
  }
  return parsed.output;
}

function parseOptionalUrl(input: string | undefined): string | undefined {
  const parsed = v.safeParse(publicAppUrlSchema, input);
  if (!parsed.success) {
    throw new Error(`AUTH_ENV_INVALID: ${collectIssues(parsed.issues)}`);
  }
  return parsed.output;
}

export function resolveAuthEnv(source: Record<string, string | undefined> = process.env): AuthEnv {
  const secret = parseRequired(secretSchema, source.BETTER_AUTH_SECRET);
  const baseURL = parseRequired(baseUrlSchema, source.BETTER_AUTH_URL);
  const publicAppUrl = parseOptionalUrl(source.PUBLIC_APP_URL);
  const isProduction = source.NODE_ENV === 'production';

  const trustedOrigins = [baseURL];
  if (publicAppUrl && !trustedOrigins.includes(publicAppUrl)) {
    trustedOrigins.push(publicAppUrl);
  }

  return {
    secret,
    baseURL,
    isProduction,
    trustedOrigins,
  };
}
