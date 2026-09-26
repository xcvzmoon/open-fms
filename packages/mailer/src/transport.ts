import { createEmail } from 'unemail';
import mock from 'unemail/drivers/mock';
import smtp from 'unemail/drivers/smtp';
import { withCircuitBreaker, withLogger } from 'unemail/middleware';
import { renderMailEvent, type MailEvent } from './events.ts';

export type MailerEnv = {
  from: string;
  mode: 'mock' | 'smtp';
  smtpHost?: string | undefined;
  smtpPort?: number | undefined;
};

export function createMailer(env: MailerEnv) {
  const driver =
    env.mode === 'mock'
      ? mock()
      : smtp({
          host: env.smtpHost ?? 'localhost',
          port: env.smtpPort ?? 1025,
          secure: false,
          rejectUnauthorized: false,
        });

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
