import type { MailEvent } from './events.ts';
import type { MailerEnv } from './transport.ts';
import { sendMailEvent } from './transport.ts';

export type MailDispatch = {
  notify: (event: MailEvent) => Promise<void>;
};

export type EmailQueue = {
  enqueue: (event: MailEvent) => Promise<void>;
  close: () => Promise<void>;
};

export function createMailDispatch(env: MailerEnv): MailDispatch {
  return {
    async notify(event) {
      await sendMailEvent(event, env);
    },
  };
}

export function createQueuedMailDispatch(queue: EmailQueue): MailDispatch {
  return {
    async notify(event) {
      await queue.enqueue(event);
    },
  };
}
