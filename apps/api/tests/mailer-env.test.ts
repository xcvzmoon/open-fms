import { describe, expect, test } from 'vite-plus/test';
import { resolveMailerEnv } from '../server/auth/mailer.ts';

const smtp = {
  NODE_ENV: 'production',
  MAIL_MODE: 'smtp',
  MAIL_FROM: 'Open FMS <mail@example.com>',
  SMTP_HOST: 'smtp.example.com',
  SMTP_PORT: '587',
};

describe('resolveMailerEnv', () => {
  test('requires explicit delivery in production', () => {
    expect(() => resolveMailerEnv({ NODE_ENV: 'production' })).toThrow(
      'MAIL_ENV_PRODUCTION_MODE_REQUIRED',
    );
    expect(() => resolveMailerEnv({ NODE_ENV: 'production', MAIL_MODE: 'mock' })).toThrow(
      'MAIL_ENV_PRODUCTION_MODE_REQUIRED',
    );
  });

  test('resolves explicit SMTP configuration', () => {
    expect(resolveMailerEnv(smtp)).toEqual({
      mode: 'smtp',
      from: smtp.MAIL_FROM,
      smtpHost: smtp.SMTP_HOST,
      smtpPort: 587,
    });
  });

  test.each(['0', '65536', '-1', '1.5', 'NaN', ''])('rejects invalid port %s', (SMTP_PORT) => {
    expect(() => resolveMailerEnv({ ...smtp, SMTP_PORT })).toThrow('MAIL_ENV_PORT_INVALID');
  });

  test.each([
    '',
    'https://smtp.example.com',
    'smtp.example.com\r\nDATA',
    'host name',
    'host..example',
    '-host.example',
  ])('rejects invalid host %s', (SMTP_HOST) => {
    expect(() => resolveMailerEnv({ ...smtp, SMTP_HOST })).toThrow('MAIL_ENV_HOST_INVALID');
  });

  test.each(['', 'invalid', 'mail@example.com\r\nBcc: other@example.com'])(
    'rejects invalid sender',
    (MAIL_FROM) => {
      expect(() => resolveMailerEnv({ ...smtp, MAIL_FROM })).toThrow('MAIL_ENV_FROM_INVALID');
    },
  );

  test('requires production sender and SMTP endpoint', () => {
    expect(() => resolveMailerEnv({ ...smtp, MAIL_FROM: undefined })).toThrow(
      'MAIL_ENV_FROM_INVALID',
    );
    expect(() => resolveMailerEnv({ ...smtp, SMTP_HOST: undefined })).toThrow(
      'MAIL_ENV_HOST_INVALID',
    );
    expect(() => resolveMailerEnv({ ...smtp, SMTP_PORT: undefined })).toThrow(
      'MAIL_ENV_PORT_INVALID',
    );
  });

  test('keeps development mock delivery available', () => {
    expect(resolveMailerEnv({}).mode).toBe('mock');
  });
});
