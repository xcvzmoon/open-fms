import { describe, expect, test } from 'vite-plus/test';
import { isEmailDomainAllowed } from '../src/security/email.ts';
import {
  generateHashedToken,
  hashToken,
  verifyTokenHash,
  type TokenPepper,
} from '../src/security/tokens.ts';

const pepper: TokenPepper = {
  secret: 'edge-pepper-secret-value-32-chars!',
  version: 3,
};

describe('token security edge cases', () => {
  test('rejects empty and wrong-length hashes', () => {
    expect(verifyTokenHash('anything', Buffer.alloc(0), pepper)).toBe(false);
    expect(verifyTokenHash('anything', Buffer.alloc(10), pepper)).toBe(false);
  });

  test('different peppers produce different hashes', () => {
    const a = hashToken('token', pepper);
    const b = hashToken('token', { ...pepper, secret: 'other-pepper-secret-value-32-chars!!' });
    expect(a.equals(b)).toBe(false);
  });

  test('generated tokens are unique', () => {
    const first = generateHashedToken(pepper);
    const second = generateHashedToken(pepper);
    expect(first.plaintext).not.toBe(second.plaintext);
    expect(first.hash.equals(second.hash)).toBe(false);
    expect(first.pepperVersion).toBe(3);
  });

  test('rejects empty token against a real hash', () => {
    const generated = generateHashedToken(pepper);
    expect(verifyTokenHash('', generated.hash, pepper)).toBe(false);
  });
});

describe('email domain allowlist edge cases', () => {
  test('rejects empty domain and malformed emails', () => {
    expect(isEmailDomainAllowed('user@', ['example.com'])).toBe(false);
    expect(isEmailDomainAllowed('@example.com', ['example.com'])).toBe(false);
    expect(isEmailDomainAllowed('', ['example.com'])).toBe(false);
  });

  test('does not treat suffix matches as allowlisted', () => {
    expect(isEmailDomainAllowed('a@notexample.com', ['example.com'])).toBe(false);
    expect(isEmailDomainAllowed('a@example.com.evil.com', ['example.com'])).toBe(false);
  });

  test('normalizes allowed domain case', () => {
    expect(isEmailDomainAllowed('a@example.com', ['EXAMPLE.COM'])).toBe(true);
  });

  test('rejects when allowlist is empty', () => {
    expect(isEmailDomainAllowed('a@example.com', [])).toBe(false);
  });
});
