import type { MailDispatch, MailerEnv } from '@open-fms/mailer';
import { createMailDispatch } from '@open-fms/mailer';
import * as v from 'valibot';

export type ApiMailerEnv = MailerEnv;

const mailerEnvSchema = v.object({
  MAIL_FROM: v.optional(
    v.pipe(v.string('MAIL_ENV_FROM_INVALID'), v.minLength(3, 'MAIL_ENV_FROM_INVALID')),
  ),
  MAIL_MODE: v.optional(v.picklist(['mock', 'smtp'], 'MAIL_ENV_MODE_INVALID')),
  SMTP_HOST: v.optional(v.string()),
  SMTP_PORT: v.optional(v.pipe(v.string(), v.regex(/^\d+$/, 'MAIL_ENV_PORT_INVALID'))),
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
  const parsed = v.safeParse(mailerEnvSchema, source);
  if (!parsed.success) {
    throw new Error(`MAIL_ENV_INVALID: ${collectIssues(parsed.issues)}`);
  }

  const smtpPort = parsed.output.SMTP_PORT;
  return {
    from: parsed.output.MAIL_FROM ?? 'Open FMS <hello@open-fms.example>',
    mode: parsed.output.MAIL_MODE ?? 'mock',
    smtpHost: parsed.output.SMTP_HOST,
    smtpPort: smtpPort ? Number(smtpPort) : undefined,
  };
}

export function getMailDispatch(): MailDispatch {
  runtime ??= createMailDispatch(resolveMailerEnv());
  return runtime;
}
