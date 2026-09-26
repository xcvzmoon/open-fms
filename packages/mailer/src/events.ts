import * as v from 'valibot';

export type MailEvent =
  | {
      type: 'auth.verify';
      email: string;
      verifyUrl: string;
    }
  | {
      type: 'auth.password-reset';
      email: string;
      resetUrl: string;
    }
  | {
      type: 'auth.setup-code';
      email: string;
      code: string;
    };

export const mailEventSchema = v.variant('type', [
  v.object({
    type: v.literal('auth.verify'),
    email: v.pipe(v.string(), v.email()),
    verifyUrl: v.pipe(v.string(), v.url()),
  }),
  v.object({
    type: v.literal('auth.password-reset'),
    email: v.pipe(v.string(), v.email()),
    resetUrl: v.pipe(v.string(), v.url()),
  }),
  v.object({
    type: v.literal('auth.setup-code'),
    email: v.pipe(v.string(), v.email()),
    code: v.pipe(v.string(), v.minLength(8)),
  }),
]);

export type RenderedMail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

export function formatMailEventIssues(issues: readonly { message: string }[]): string {
  const messages: string[] = [];
  for (const issue of issues) {
    messages.push(issue.message);
  }
  return messages.join('; ');
}

export function renderMailEvent(event: MailEvent): RenderedMail {
  if (event.type === 'auth.verify') {
    return {
      to: event.email,
      subject: 'Verify your Open FMS email',
      text: `Confirm your email address:\n\n${event.verifyUrl}`,
      html: `<p>Confirm your email address.</p><p><a href="${escapeAttr(event.verifyUrl)}">Verify email</a></p>`,
    };
  }

  if (event.type === 'auth.password-reset') {
    return {
      to: event.email,
      subject: 'Reset your Open FMS password',
      text: `Reset your password:\n\n${event.resetUrl}`,
      html: `<p>Reset your password.</p><p><a href="${escapeAttr(event.resetUrl)}">Reset password</a></p>`,
    };
  }

  return {
    to: event.email,
    subject: 'Your Open FMS setup code',
    text: `Your setup code:\n\n${event.code}\n\nThis code can be used once.`,
    html: `<p>Your setup code:</p><p><code>${escapeHtml(event.code)}</code></p><p>This code can be used once.</p>`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("'", '&#39;');
}
