import type { MailEvent } from './events.ts';
import type { MailerEnv } from './transport.ts';
import { createMailer, sendMailEvent } from './transport.ts';

export type MailDispatch = {
  notify: (event: MailEvent) => Promise<void>;
};

export function createMailDispatch(env: MailerEnv): MailDispatch {
  const email = createMailer(env);
  return {
    async notify(event) {
      await sendMailEvent(email, event);
    },
  };
}
