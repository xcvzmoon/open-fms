import type { MailDispatch, MailerEnv } from '@open-fms/mailer';
import { createMailDispatch, mailerEnvSchema } from '@open-fms/mailer';
import * as v from 'valibot';

export type ApiMailerEnv = MailerEnv;

const sourceSchema = v.object({
  NODE_ENV: v.optional(v.string()),
  MAIL_FROM: v.optional(v.string()),
  MAIL_MODE: v.optional(v.picklist(['mock', 'smtp'], 'MAIL_ENV_MODE_INVALID')),
  SMTP_HOST: v.optional(v.string()),
  SMTP_PORT: v.optional(
    v.pipe(v.string(), v.regex(/^\d+$/, 'MAIL_ENV_PORT_INVALID'), v.transform(Number)),
  ),
});

let runtime: MailDispatch | undefined;

function collectIssues(issues: readonly v.BaseIssue<unknown>[]): string {
  const messages: string[] = [];
  for (const issue of issues) {
    messages.push(issue.message);
  }
  return messages.join('; ');
}

export function resolveMailerEnv(
  source: Record<string, string | undefined> = process.env,
): ApiMailerEnv {
  const parsed = v.safeParse(sourceSchema, source);
  if (!parsed.success) {
    throw new Error(`MAIL_ENV_INVALID: ${collectIssues(parsed.issues)}`);
  }

  const config = parsed.output;
  if (config.NODE_ENV === 'production' && config.MAIL_MODE !== 'smtp') {
    throw new Error('MAIL_ENV_PRODUCTION_MODE_REQUIRED');
  }
  const resolved = v.safeParse(mailerEnvSchema, {
    from:
      config.MAIL_FROM ??
      (config.NODE_ENV === 'production' ? undefined : 'Open FMS <hello@open-fms.example>'),
    mode: config.MAIL_MODE ?? 'mock',
    smtpHost: config.SMTP_HOST,
    smtpPort: config.SMTP_PORT,
  });
  if (!resolved.success) {
    throw new Error(`MAIL_ENV_INVALID: ${collectIssues(resolved.issues)}`);
  }
  return resolved.output;
}

export function getMailDispatch(): MailDispatch {
  runtime ??= createMailDispatch(resolveMailerEnv());
  return runtime;
}
