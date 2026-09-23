import type * as EmailModule from '../../../server/utils/email.ts';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { setValidApiEnv } from '../../support/env-fixture.ts';

type SentEmailMessage = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

type SendResult = { data?: unknown; error?: unknown };

const { sendMock, createEmailMock, resendDriverMock, smtpDriverMock } = vi.hoisted(() => ({
  sendMock: vi.fn<(message: SentEmailMessage) => Promise<SendResult>>(),
  createEmailMock: vi.fn(),
  resendDriverMock: vi.fn((_options: { apiKey: string }) => ({ type: 'resend' })),
  smtpDriverMock: vi.fn(
    (_options: {
      host: string;
      port?: number;
      user: string;
      password: string;
      secure?: boolean;
    }) => ({
      type: 'smtp',
    }),
  ),
}));

vi.mock('unemail', () => ({
  createEmail: createEmailMock,
}));
vi.mock('unemail/drivers/resend', () => ({ default: resendDriverMock }));
vi.mock('unemail/drivers/smtp', () => ({ default: smtpDriverMock }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  sendMock.mockReset();
  createEmailMock.mockReset();
  resendDriverMock.mockClear();
  smtpDriverMock.mockClear();
});

/**
 * `email.ts` builds its `Email` handle once at module load by calling
 * `createEmail({ driver }).use(...)`, so every test needs a fresh module
 * instance (`vi.resetModules()` + dynamic import) to pick up the driver
 * selected for that test's env.
 */
async function importEmail(): Promise<typeof EmailModule> {
  const emailHandle = { send: sendMock };
  createEmailMock.mockReturnValue(emailHandle);

  return import('../../../server/utils/email.ts');
}

describe('createDriver (module init)', () => {
  it('prefers the Resend driver when RESEND_API_KEY is set', async () => {
    setValidApiEnv({ RESEND_API_KEY: 'resend-secret' });

    await importEmail();

    expect(resendDriverMock).toHaveBeenCalledExactlyOnceWith({ apiKey: 'resend-secret' });
    expect(smtpDriverMock).not.toHaveBeenCalled();
  });

  it('falls back to the SMTP driver when only SMTP_* vars are set', async () => {
    setValidApiEnv({
      SMTP_HOST: 'smtp.buildr.test',
      SMTP_PORT: '587',
      SMTP_USER: 'apikey',
      SMTP_PASS: 'smtp-secret',
      SMTP_SECURE: 'true',
    });

    await importEmail();

    expect(smtpDriverMock).toHaveBeenCalledExactlyOnceWith({
      host: 'smtp.buildr.test',
      port: 587,
      user: 'apikey',
      password: 'smtp-secret',
      secure: true,
    });
    expect(resendDriverMock).not.toHaveBeenCalled();
  });

  it('prefers Resend over SMTP when both are configured', async () => {
    setValidApiEnv({
      RESEND_API_KEY: 'resend-secret',
      SMTP_HOST: 'smtp.buildr.test',
      SMTP_USER: 'apikey',
      SMTP_PASS: 'smtp-secret',
    });

    await importEmail();

    expect(resendDriverMock).toHaveBeenCalledTimes(1);
    expect(smtpDriverMock).not.toHaveBeenCalled();
  });

  it('requires all of SMTP_HOST, SMTP_USER, and SMTP_PASS together', async () => {
    setValidApiEnv({ SMTP_HOST: 'smtp.buildr.test', SMTP_USER: 'apikey' });

    await expect(importEmail()).rejects.toThrow(
      'Set RESEND_API_KEY, or SMTP_HOST/SMTP_USER/SMTP_PASS, to send email',
    );
  });

  it('throws EMAIL_DRIVER_NOT_CONFIGURED when no driver is configured', async () => {
    setValidApiEnv();

    let caughtError: unknown;
    try {
      await importEmail();
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toMatchObject({ code: 'EMAIL_DRIVER_NOT_CONFIGURED' });
  });
});

describe('sendVerificationEmail', () => {
  it('sends from env.email.from with the recipient, name, and link', async () => {
    setValidApiEnv({ RESEND_API_KEY: 'resend-secret' });
    sendMock.mockResolvedValue({ data: { id: 'email_1' }, error: undefined });
    const { sendVerificationEmail } = await importEmail();

    await sendVerificationEmail({
      to: 'jane@example.com',
      name: 'Jane Doe',
      url: 'https://app.buildr.test/verify?token=abc123',
    });

    expect(sendMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        from: 'Buildr <hello@buildr.test>',
        to: 'jane@example.com',
        subject: 'Verify your email address',
      }),
    );

    const message = sendMock.mock.calls.at(0)?.[0];
    if (!message) throw new Error('email.send() was not called');
    expect(message.html).toContain('Jane Doe');
    expect(message.html).toContain('https://app.buildr.test/verify?token=abc123');
  });

  it('throws the driver error instead of swallowing it', async () => {
    setValidApiEnv({ RESEND_API_KEY: 'resend-secret' });
    const driverError = new Error('Resend API rejected the request');
    sendMock.mockResolvedValue({ data: undefined, error: driverError });
    const { sendVerificationEmail } = await importEmail();

    await expect(
      sendVerificationEmail({
        to: 'jane@example.com',
        name: 'Jane Doe',
        url: 'https://app.buildr.test',
      }),
    ).rejects.toThrow(driverError);
  });
});

describe('sendPasswordResetOtpEmail', () => {
  it('sends from env.email.from with the recipient and OTP', async () => {
    setValidApiEnv({ RESEND_API_KEY: 'resend-secret' });
    sendMock.mockResolvedValue({ data: { id: 'email_2' }, error: undefined });
    const { sendPasswordResetOtpEmail } = await importEmail();

    await sendPasswordResetOtpEmail({ to: 'jane@example.com', otp: '482913' });

    expect(sendMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        from: 'Buildr <hello@buildr.test>',
        to: 'jane@example.com',
        subject: 'Reset your password',
      }),
    );
  });

  it('throws the driver error instead of swallowing it', async () => {
    setValidApiEnv({ RESEND_API_KEY: 'resend-secret' });
    const driverError = new Error('SMTP connection refused');
    sendMock.mockResolvedValue({ data: undefined, error: driverError });
    const { sendPasswordResetOtpEmail } = await importEmail();

    await expect(
      sendPasswordResetOtpEmail({ to: 'jane@example.com', otp: '482913' }),
    ).rejects.toThrow(driverError);
  });
});
