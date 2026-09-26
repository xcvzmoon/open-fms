import * as v from 'valibot';
import { describe, expect, test } from 'vite-plus/test';
import {
  createMailDispatch,
  formatMailEventIssues,
  mailEventSchema,
  renderMailEvent,
  type MailEvent,
} from '../src/index.ts';

const from = 'Open FMS <hello@open-fms.example>';

const verifyEvent: MailEvent = {
  type: 'auth.verify',
  email: 'ada@example.com',
  verifyUrl: 'https://fms.example/verify?token=abc',
};

describe('renderMailEvent', () => {
  test('renders verification mail with link', () => {
    const message = renderMailEvent(verifyEvent);
    expect(message.to).toBe('ada@example.com');
    expect(message.subject).toContain('Verify');
    expect(message.text).toContain(verifyEvent.verifyUrl);
  });

  test('renders password reset mail with link', () => {
    const message = renderMailEvent({
      type: 'auth.password-reset',
      email: 'bob@example.com',
      resetUrl: 'https://fms.example/reset?token=xyz',
    });
    expect(message.subject).toContain('Reset');
    expect(message.text).toContain('token=xyz');
  });

  test('escapes setup code in html', () => {
    const message = renderMailEvent({
      type: 'auth.setup-code',
      email: 'c@example.com',
      code: '<script>',
    });
    expect(message.html).toContain('&lt;script&gt;');
    expect(message.html).not.toContain('<script>');
  });
});

describe('mailEventSchema', () => {
  test('accepts a valid verify event', () => {
    const result = v.safeParse(mailEventSchema, verifyEvent);
    expect(result.success).toBe(true);
  });

  test('rejects a non-url verify link', () => {
    const result = v.safeParse(mailEventSchema, {
      type: 'auth.verify',
      email: 'ada@example.com',
      verifyUrl: 'not-a-url',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(formatMailEventIssues(result.issues).length).toBeGreaterThan(0);
    }
  });
});

describe('createMailDispatch', () => {
  test('delivers auth mail through the mock transport', async () => {
    const dispatch = createMailDispatch({ from, mode: 'mock' });
    await expect(dispatch.notify(verifyEvent)).resolves.toBeUndefined();
    await expect(
      dispatch.notify({
        type: 'auth.password-reset',
        email: 'bob@example.com',
        resetUrl: 'https://fms.example/reset',
      }),
    ).resolves.toBeUndefined();
    await expect(
      dispatch.notify({ type: 'auth.setup-code', email: 'c@example.com', code: 'abcdefgh' }),
    ).resolves.toBeUndefined();
  });
});
