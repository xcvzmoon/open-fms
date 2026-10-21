import { isIP } from 'node:net';
import { createEmail } from 'unemail';
import mock, { createInbox } from 'unemail/drivers/mock';
import smtp, { type SmtpOptions } from 'unemail/drivers/smtp';
import { withCircuitBreaker, withLogger } from 'unemail/middleware';
import * as v from 'valibot';
import { renderMailEvent, type MailEvent } from './events.ts';

const fromSchema = v.pipe(
  v.string('MAIL_ENV_FROM_INVALID'),
  v.check((value) => {
    if (/[\r\n]/.test(value)) return false;
    const address = value.match(/^[^<>]+<([^<>]+)>$/)?.[1] ?? value;
    return v.safeParse(v.pipe(v.string(), v.email()), address).success;
  }, 'MAIL_ENV_FROM_INVALID'),
);

export const mailerEnvSchema = v.variant('mode', [
  v.object({ mode: v.literal('mock'), from: fromSchema }),
  v.object({
    mode: v.literal('smtp'),
    from: fromSchema,
    smtpHost: v.pipe(
      v.string('MAIL_ENV_HOST_INVALID'),
      v.check(
        (host) =>
          isIP(host) !== 0 ||
          (host.length <= 253 &&
            /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(
              host,
            )),
        'MAIL_ENV_HOST_INVALID',
      ),
    ),
    smtpPort: v.pipe(
      v.number('MAIL_ENV_PORT_INVALID'),
      v.integer('MAIL_ENV_PORT_INVALID'),
      v.minValue(1, 'MAIL_ENV_PORT_INVALID'),
      v.maxValue(65535, 'MAIL_ENV_PORT_INVALID'),
    ),
  }),
]);

export type MailerEnv = v.InferOutput<typeof mailerEnvSchema>;

export function resolveSmtpOptions(env: Extract<MailerEnv, { mode: 'smtp' }>): SmtpOptions {
  const parsed = v.parse(mailerEnvSchema, env);
  if (parsed.mode !== 'smtp') throw new Error('MAIL_ENV_MODE_INVALID');
  return {
    host: parsed.smtpHost,
    port: parsed.smtpPort,
    secure: parsed.smtpPort === 465,
    requireTLS: true,
    rejectUnauthorized: true,
  };
}

export function createMailer(env: MailerEnv) {
  const config = v.parse(mailerEnvSchema, env);
  const inbox = createInbox();
  const driver =
    config.mode === 'mock'
      ? mock({
          inbox,
          failWhen: () => {
            if (inbox.messages.length >= 100) inbox.clear();
            return false;
          },
        })
      : smtp(resolveSmtpOptions(config));

  return createEmail({
    driver,
    defaults: { from: env.from },
    use: [withLogger(), withCircuitBreaker({ threshold: 5 })],
  });
}

export async function sendMailEvent(
  email: ReturnType<typeof createMailer>,
  event: MailEvent,
): Promise<void> {
  const { error } = await email.send(renderMailEvent(event));
  if (error) {
    throw new Error(`MAIL_SEND_FAILED: ${error.code} ${error.message}`);
  }
}
