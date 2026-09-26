import type { MailDispatch, MailerEnv } from '@open-fms/mailer';
import { createMailDispatch } from '@open-fms/mailer';

let runtime: MailDispatch | undefined;

function toPortNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function resolveMailerEnv(
  env: {
    MAIL_FROM?: string | undefined;
    MAIL_MODE?: string | undefined;
    SMTP_HOST?: string | undefined;
    SMTP_PORT?: string | undefined;
  } = process.env,
): MailerEnv {
  return {
    from: env.MAIL_FROM ?? 'Open FMS <hello@open-fms.example>',
    mode: env.MAIL_MODE === 'smtp' ? 'smtp' : 'mock',
    smtpHost: env.SMTP_HOST,
    smtpPort: toPortNumber(env.SMTP_PORT),
  };
}

export function getMailDispatch(): MailDispatch {
  runtime ??= createMailDispatch(resolveMailerEnv());
  return runtime;
}
