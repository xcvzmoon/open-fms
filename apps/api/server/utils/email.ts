import type { EmailMessage } from 'unemail';
import Handlebars from 'handlebars';
import { createEmail } from 'unemail';
import resend from 'unemail/drivers/resend';
import smtp from 'unemail/drivers/smtp';
import { env } from '~/server/utils/env.ts';

export class EmailConfigError extends Error {
  readonly code = 'EMAIL_DRIVER_NOT_CONFIGURED';

  constructor() {
    super('Set RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS, to send email');
  }
}

function createDriver() {
  if (env.resend.apiKey) return resend({ apiKey: env.resend.apiKey });

  if (env.smtp.host && env.smtp.user && env.smtp.pass) {
    return smtp({
      host: env.smtp.host,
      port: env.smtp.port,
      user: env.smtp.user,
      password: env.smtp.pass,
      secure: env.smtp.secure,
    });
  }

  throw new EmailConfigError();
}

const shellPartial = `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;padding:40px;">
            <tr>
              <td>
                <p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#18181b;letter-spacing:-0.01em;">Buildr</p>
                {{> @partial-block }}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

Handlebars.registerPartial('shell', shellPartial);

const email = createEmail({ driver: createDriver() });

function renderTemplate(template: string, variables: Record<string, string>): string {
  return Handlebars.compile(template)(variables);
}

type VerificationEmailVars = {
  name: string;
  url: string;
};

function verificationEmailTemplate(vars: VerificationEmailVars): Partial<EmailMessage> {
  return {
    subject: 'Verify your email address',
    html: renderTemplate(
      `{{#> shell}}
    <h1 style="margin:0 0 12px;font-size:20px;color:#18181b;">Verify your email</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#52525b;">Hi {{name}}, confirm this address to finish setting up your account.</p>
    <a href="{{{url}}}" style="display:inline-block;padding:10px 20px;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;border-radius:8px;">Verify email</a>
    <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;">If you didn't create an account, you can ignore this email.</p>
  {{/shell}}`,
      vars,
    ),
  };
}

type PasswordResetOtpEmailVars = {
  otp: string;
};

function passwordResetOtpEmailTemplate(vars: PasswordResetOtpEmailVars): Partial<EmailMessage> {
  return {
    subject: 'Reset your password',
    html: renderTemplate(
      `{{#> shell}}
    <h1 style="margin:0 0 12px;font-size:20px;color:#18181b;">Reset your password</h1>
    <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#52525b;">Enter this code to reset your password. It expires in 5 minutes.</p>
    <p style="margin:0 0 24px;font-size:32px;font-weight:700;letter-spacing:0.3em;color:#18181b;">{{otp}}</p>
    <p style="margin:0;font-size:12px;color:#a1a1aa;">If you didn't request this, you can ignore this email.</p>
  {{/shell}}`,
      vars,
    ),
  };
}

type SendVerificationEmailInput = {
  to: string;
  name: string;
  url: string;
};

export async function sendVerificationEmail(input: SendVerificationEmailInput): Promise<void> {
  const { error } = await email.send({
    from: env.email.from,
    to: input.to,
    ...verificationEmailTemplate({ name: input.name, url: input.url }),
  });

  if (error) throw error;
}

type SendPasswordResetOtpEmailInput = {
  to: string;
  otp: string;
};

export async function sendPasswordResetOtpEmail(
  input: SendPasswordResetOtpEmailInput,
): Promise<void> {
  const { error } = await email.send({
    from: env.email.from,
    to: input.to,
    ...passwordResetOtpEmailTemplate({ otp: input.otp }),
  });

  if (error) throw error;
}
