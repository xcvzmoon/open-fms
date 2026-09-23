import * as v from 'valibot';
import { describe, expect, it } from 'vite-plus/test';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  signinSchema,
  signupSchema,
} from '../../../app/utils/auth-schemas.ts';

describe('signinSchema', () => {
  it('accepts a valid email and non-empty password', () => {
    const result = v.safeParse(signinSchema, { email: 'jane@example.com', password: 'secret' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = v.safeParse(signinSchema, { email: 'not-an-email', password: 'secret' });
    expect(result.success).toBe(false);
  });

  it('rejects an empty password', () => {
    const result = v.safeParse(signinSchema, { email: 'jane@example.com', password: '' });
    expect(result.success).toBe(false);
  });
});

describe('signupSchema', () => {
  it('accepts a valid name, email, and 8+ character password', () => {
    const result = v.safeParse(signupSchema, {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an empty name', () => {
    const result = v.safeParse(signupSchema, {
      name: '',
      email: 'jane@example.com',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = v.safeParse(signupSchema, {
      name: 'Jane Doe',
      email: 'jane@example.com',
      password: 'short1',
    });
    expect(result.success).toBe(false);
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    const result = v.safeParse(forgotPasswordSchema, { email: 'jane@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = v.safeParse(forgotPasswordSchema, { email: 'not-an-email' });
    expect(result.success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('accepts a valid email, 6-digit code, and 8+ character password', () => {
    const result = v.safeParse(resetPasswordSchema, {
      email: 'jane@example.com',
      otp: '123456',
      password: 'password123',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an OTP that is not 6 digits', () => {
    const result = v.safeParse(resetPasswordSchema, {
      email: 'jane@example.com',
      otp: '123',
      password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = v.safeParse(resetPasswordSchema, {
      email: 'jane@example.com',
      otp: '123456',
      password: 'short1',
    });
    expect(result.success).toBe(false);
  });
});
