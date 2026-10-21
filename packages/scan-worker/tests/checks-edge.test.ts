import { describe, expect, test } from 'vite-plus/test';
import { defaultArchiveBombPolicy, checkArchiveBomb, checkStructure } from '../src/checks.ts';

describe('scan check edge cases', () => {
  test('rejects empty zip-like payloads that exceed entry policy', async () => {
    const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const payload = Buffer.concat([header, header, header]);
    const result = await checkArchiveBomb(payload, {
      maxEntries: 1,
      maxDeclaredUncompressedBytes: defaultArchiveBombPolicy.maxDeclaredUncompressedBytes,
    });
    expect(result.ok).toBe(false);
  });

  test('rejects truncated zip-like payloads', async () => {
    const payload = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const result = await checkArchiveBomb(payload, {
      maxEntries: 10,
      maxDeclaredUncompressedBytes: 1024,
    });
    expect(result.ok).toBe(false);
  });

  test('rejects repeated signatures without ZIP metadata', async () => {
    const header = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    const bomb = Buffer.concat(Array.from({ length: 40 }, () => header));
    const result = await checkArchiveBomb(bomb, {
      maxEntries: 10_000,
      maxDeclaredUncompressedBytes: 1_000_000_000,
    });
    expect(result.ok).toBe(false);
  });

  test('empty structure check fails closed', async () => {
    expect((await checkStructure(new Uint8Array(0))).ok).toBe(false);
  });
});
