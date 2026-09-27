import { describe, expect, test } from 'vite-plus/test';
import { defaultArchiveBombPolicy, checkArchiveBomb, checkStructure } from '../src/checks.ts';

describe('scan check edge cases', () => {
  test('rejects empty zip-like payloads that exceed entry policy', () => {
    const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const payload = Buffer.concat([header, header, header]);
    const result = checkArchiveBomb(payload, {
      maxEntries: 1,
      maxDeclaredUncompressedBytes: defaultArchiveBombPolicy.maxDeclaredUncompressedBytes,
    });
    expect(result.ok).toBe(false);
  });

  test('allows small zip-like payloads under policy', () => {
    const payload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const result = checkArchiveBomb(payload, {
      maxEntries: 10,
      maxDeclaredUncompressedBytes: 1024,
    });
    expect(result.ok).toBe(true);
  });

  test('flags extreme compression-ratio archives', () => {
    const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const bomb = Buffer.concat(Array.from({ length: 40 }, () => header));
    const result = checkArchiveBomb(bomb, {
      maxEntries: 10_000,
      maxDeclaredUncompressedBytes: 1_000_000_000,
    });
    expect(result.ok).toBe(false);
  });

  test('empty structure check fails closed', () => {
    expect(checkStructure(new Uint8Array(0)).ok).toBe(false);
  });
});
