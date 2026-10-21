import { describe, expect, test } from 'vite-plus/test';
import { checkArchiveBomb, checkStructure, hashBytes, verifyChecksum } from '../src/checks.ts';

describe('scan checks', () => {
  test('hashes and verifies checksums', () => {
    const bytes = Buffer.from('hello scan');
    const digest = hashBytes(bytes);
    expect(verifyChecksum(bytes, digest)).toBe(true);
    expect(verifyChecksum(Buffer.from('tampered'), digest)).toBe(false);
  });

  test('rejects empty payloads', async () => {
    const result = await checkStructure(new Uint8Array());
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('empty');
  });

  test('allows non-archive payloads', async () => {
    const result = await checkArchiveBomb(Buffer.from('plain text payload'));
    expect(result.ok).toBe(true);
  });

  test('flags zip bombs by entry count', async () => {
    const zipHeader = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const bomb = Buffer.concat(Array.from({ length: 50 }, () => zipHeader));
    const result = await checkArchiveBomb(bomb, {
      maxEntries: 10,
      maxDeclaredUncompressedBytes: 1024,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('SCAN_ARCHIVE_BOMB');
  });
});
