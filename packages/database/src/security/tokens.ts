import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type TokenPepper = {
  secret: string;
  version: number;
};

export type GeneratedToken = {
  plaintext: string;
  hash: Buffer;
  pepperVersion: number;
};

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string, pepper: TokenPepper): Buffer {
  return createHmac('sha256', pepper.secret).update(token).digest();
}

export function verifyTokenHash(token: string, hash: Buffer, pepper: TokenPepper): boolean {
  const candidate = hashToken(token, pepper);
  if (candidate.length !== hash.length) {
    return false;
  }
  return timingSafeEqual(candidate, hash);
}

export function generateHashedToken(pepper: TokenPepper): GeneratedToken {
  const plaintext = generateToken();
  return {
    plaintext,
    hash: hashToken(plaintext, pepper),
    pepperVersion: pepper.version,
  };
}
