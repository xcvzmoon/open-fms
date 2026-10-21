import { crc32, deflateRawSync } from 'node:zlib';
import { expect, test } from 'vite-plus/test';
import { checkArchiveBomb, checkArchiveFile, checkContentType } from '../src/checks.ts';
import { spoolObject } from '../src/spool.ts';

type TestEntry = { name: string; bytes: Buffer; method: 0 | 8; declaredSize?: number };
function zip(entries: TestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const compressed = entry.method === 8 ? deflateRawSync(entry.bytes) : entry.bytes;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(crc32(entry.bytes), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.declaredSize ?? entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(crc32(entry.bytes), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.declaredSize ?? entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, compressed);
    directory.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, central, end]);
}
function file(method: 0 | 8): TestEntry {
  return { name: 'file.txt', bytes: Buffer.from('hello'), method };
}

test('accepts real stored and deflate entries and empty ZIPs', async () => {
  expect((await checkArchiveBomb(zip([file(0), file(8)]))).ok).toBe(true);
  expect((await checkArchiveBomb(zip([]))).ok).toBe(true);
});
test('enforces entry count and cumulative uncompressed bytes', async () => {
  const bytes = zip([file(0), file(8)]);
  expect(
    (await checkArchiveBomb(bytes, { maxEntries: 1, maxDeclaredUncompressedBytes: 100 })).ok,
  ).toBe(false);
  expect(
    (await checkArchiveBomb(bytes, { maxEntries: 2, maxDeclaredUncompressedBytes: 9 })).ok,
  ).toBe(false);
});
test('fails closed on truncated metadata and deflate output inconsistent with declared size', async () => {
  const bytes = zip([file(8)]);
  expect((await checkArchiveBomb(bytes.subarray(0, bytes.length - 5))).ok).toBe(false);
  expect((await checkArchiveBomb(zip([{ ...file(8), declaredSize: 1 }]))).ok).toBe(false);
  expect((await checkArchiveBomb(zip([{ ...file(8), declaredSize: 10 }]))).ok).toBe(false);
  expect((await checkArchiveBomb(zip([{ ...file(0), declaredSize: 10 }]))).ok).toBe(false);
});
test('rejects nested archives by decoded filename or decompressed content signature', async () => {
  expect((await checkArchiveBomb(zip([{ ...file(8), name: 'nested.zip' }]))).ok).toBe(false);
  const nested = zip([file(0)]);
  await Promise.all(
    ([0, 8] as const).map(async (method) => {
      expect(
        (await checkArchiveBomb(zip([{ name: 'ordinary.bin', bytes: nested, method }]))).ok,
      ).toBe(false);
    }),
  );
});
test('rejects unsafe names, excessive depth, encryption, and unsupported compression', async () => {
  await Promise.all(
    ['../escape', 'folder\\file', '/absolute', `${'folder/'.repeat(17)}file`].map(async (name) => {
      expect((await checkArchiveBomb(zip([{ ...file(0), name }]))).ok).toBe(false);
    }),
  );
  const encrypted = zip([file(0)]);
  const central = encrypted.readUInt32LE(encrypted.length - 6);
  encrypted.writeUInt16LE(1, central + 8);
  expect((await checkArchiveBomb(encrypted)).ok).toBe(false);
  const unsupported = zip([file(0)]);
  unsupported.writeUInt16LE(99, central + 10);
  expect((await checkArchiveBomb(unsupported)).ok).toBe(false);
});
test('production inspection reads the spooled file and honors cancellation', async () => {
  const bytes = zip([{ name: 'large.txt', bytes: Buffer.alloc(4 * 1024 * 1024, 65), method: 8 }]);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  const spool = await spoolObject(body, bytes.length, new AbortController().signal);
  try {
    expect((await checkArchiveFile(spool.path, spool.prefix, spool.sizeBytes)).ok).toBe(true);
    const controller = new AbortController();
    const pending = checkArchiveFile(
      spool.path,
      spool.prefix,
      spool.sizeBytes,
      undefined,
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 1);
    expect((await pending).ok).toBe(false);
  } finally {
    await spool.cleanup();
  }
});
test('enforces sniffed MIME against caller policy and declaration', () => {
  expect(checkContentType(null, 'image/png', ['image/png'])).toBe(false);
  expect(checkContentType('image/png', 'image/jpeg', ['image/png'])).toBe(false);
  expect(checkContentType('image/png', 'image/png', ['image/jpeg'])).toBe(false);
  expect(checkContentType('image/png', 'image/png', ['image/png'])).toBe(true);
});
