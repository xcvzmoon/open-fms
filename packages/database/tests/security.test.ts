import { describe, expect, test } from 'vite-plus/test';
import { isEmailDomainAllowed } from '../src/security/email.ts';
import {
  generateHashedToken,
  hashToken,
  verifyTokenHash,
  type TokenPepper,
} from '../src/security/tokens.ts';

const pepper: TokenPepper = {
  secret: 'test-pepper-secret-value-32-chars!!',
  version: 1,
};

describe('token security', () => {
  test('hashes and verifies tokens', () => {
    const generated = generateHashedToken(pepper);
    expect(generated.plaintext.length).toBeGreaterThan(20);
    expect(verifyTokenHash(generated.plaintext, generated.hash, pepper)).toBe(true);
    expect(verifyTokenHash('wrong', generated.hash, pepper)).toBe(false);
  });

  test('hash is deterministic for the same pepper', () => {
    const first = hashToken('token', pepper);
    const second = hashToken('token', pepper);
    expect(first.equals(second)).toBe(true);
  });
});

describe('email domain allowlist', () => {
  test('matches exact domains case-insensitively', () => {
    expect(isEmailDomainAllowed('a@Example.com', ['example.com'])).toBe(true);
    expect(isEmailDomainAllowed('a@sub.example.com', ['example.com'])).toBe(false);
    expect(isEmailDomainAllowed('a@example.com', ['example.com'])).toBe(true);
    expect(isEmailDomainAllowed('not-an-email', ['example.com'])).toBe(false);
  });
});
