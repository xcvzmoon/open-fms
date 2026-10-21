import type { Readable } from 'node:stream';
import type { Entry, ZipFile } from 'yauzl';
import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as v from 'valibot';
import { fromBufferPromise, openPromise } from 'yauzl';

export type ContentInspection = {
  sha256: Buffer;
  sizeBytes: number;
  detectedMime: string | null;
  detectedExt: string | null;
};

export type StructureCheckResult = {
  ok: boolean;
  reason: string | null;
};

export type ScanCheckFailure =
  | 'SCAN_HASH_MISMATCH'
  | 'SCAN_TYPE_UNKNOWN'
  | 'SCAN_ARCHIVE_BOMB'
  | 'SCAN_STRUCTURE_INVALID'
  | 'SCAN_CLAMAV_INFECTED'
  | 'SCAN_CLAMAV_ERROR';

export function hashBytes(bytes: Uint8Array): Buffer {
  return createHash('sha256').update(bytes).digest();
}

export function verifyChecksum(bytes: Uint8Array, expectedSha256: Buffer): boolean {
  return hashBytes(bytes).equals(expectedSha256);
}

export async function sniffContentType(bytes: Uint8Array): Promise<ContentInspection> {
  const { fileTypeFromBuffer } = await import('file-type');
  const sniffed = await fileTypeFromBuffer(bytes);
  return {
    sha256: hashBytes(bytes),
    sizeBytes: bytes.length,
    detectedMime: sniffed?.mime ?? null,
    detectedExt: sniffed?.ext ?? null,
  };
}

const ZIP_LOCAL_FILE_SIG = [0x50, 0x4b, 0x03, 0x04];
const ZIP_EMPTY_SIG = [0x50, 0x4b, 0x05, 0x06];
const ZIP_SPANNED_SIG = [0x50, 0x4b, 0x07, 0x08];

function matchesSignature(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) {
    return false;
  }
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[index] !== signature[index]) {
      return false;
    }
  }
  return true;
}

export function isZipLike(bytes: Uint8Array): boolean {
  return (
    matchesSignature(bytes, ZIP_LOCAL_FILE_SIG) ||
    matchesSignature(bytes, ZIP_EMPTY_SIG) ||
    matchesSignature(bytes, ZIP_SPANNED_SIG)
  );
}

export type ArchiveBombPolicy = {
  maxEntries: number;
  maxDeclaredUncompressedBytes: number;
};
export const defaultArchiveBombPolicy: ArchiveBombPolicy = {
  maxEntries: 10_000,
  maxDeclaredUncompressedBytes: 4 * 1024 * 1024 * 1024,
};

function hasArchiveSignature(prefix: Buffer): boolean {
  return (
    isZipLike(prefix) ||
    /^(1f8b|377abcaf271c|52617221|425a68|fd377a585a00)/.test(prefix.toString('hex')) ||
    prefix.subarray(257, 262).toString() === 'ustar'
  );
}
function invalid(): StructureCheckResult {
  return { ok: false, reason: 'SCAN_ARCHIVE_BOMB:invalid_or_unsupported_archive' };
}
const zipOptions = {
  lazyEntries: true,
  strictFileNames: true,
  validateEntrySizes: true,
  autoClose: false,
};

async function inspectZip(
  zip: ZipFile,
  policy: ArchiveBombPolicy,
  signal: AbortSignal,
): Promise<StructureCheckResult> {
  return new Promise((resolve) => {
    let settled = false;
    let entries = 0;
    let declaredBytes = 0;
    let actualBytes = 0;
    let activeStream: Readable | undefined;
    function finish(result: StructureCheckResult): void {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      activeStream?.destroy();
      zip.close();
      resolve(result);
    }
    function abort(): void {
      finish(invalid());
    }
    zip.on('error', abort);
    zip.on('end', () => {
      finish(entries === zip.entryCount ? { ok: true, reason: null } : invalid());
    });
    zip.on('close', () => {
      if (!settled) finish(invalid());
    });
    signal.addEventListener('abort', abort, { once: true });
    zip.on('entry', (entry: Entry) => {
      void inspectEntry(entry)
        .then(() => {
          if (!settled) zip.readEntry();
        })
        .catch(abort);
    });
    async function inspectEntry(entry: Entry): Promise<void> {
      signal.throwIfAborted();
      entries += 1;
      declaredBytes += entry.uncompressedSize;
      if (
        entries > policy.maxEntries ||
        declaredBytes > policy.maxDeclaredUncompressedBytes ||
        !Number.isSafeInteger(entry.uncompressedSize) ||
        entry.uncompressedSize < 0 ||
        entry.isEncrypted() ||
        (entry.generalPurposeBitFlag & 64) !== 0 ||
        ![0, 8].includes(entry.compressionMethod) ||
        entry.fileName.split('/').length > 16 ||
        /\.(zip|jar|docx|xlsx|pptx|gz|tgz|bz2|xz|7z|rar|tar)$/i.test(entry.fileName)
      ) {
        throw new Error('SCAN_ARCHIVE_LIMIT');
      }
      const stream = await zip.openReadStreamPromise(entry);
      activeStream = stream;
      if (settled) {
        stream.destroy();
        return;
      }
      let entryBytes = 0;
      let prefixLength = 0;
      const prefix = Buffer.alloc(8192);
      const sink = new Writable({
        write(chunk, _encoding, callback) {
          try {
            const bytes = v.parse(v.instance(Uint8Array), chunk);
            entryBytes += bytes.length;
            actualBytes += bytes.length;
            if (
              entryBytes > entry.uncompressedSize ||
              actualBytes > policy.maxDeclaredUncompressedBytes
            ) {
              callback(new Error('SCAN_ARCHIVE_LIMIT'));
              return;
            }
            const copied = Math.min(prefix.length - prefixLength, bytes.length);
            prefix.set(bytes.subarray(0, copied), prefixLength);
            prefixLength += copied;
            if (copied > 0 && hasArchiveSignature(prefix.subarray(0, prefixLength))) {
              callback(new Error('SCAN_ARCHIVE_NESTED'));
              return;
            }
            callback();
          } catch {
            callback(new Error('SCAN_ARCHIVE_INVALID'));
          }
        },
      });
      await pipeline(stream, sink, { signal });
      activeStream = undefined;
      if (entryBytes !== entry.uncompressedSize) throw new Error('SCAN_ARCHIVE_SIZE_MISMATCH');
    }
    if (signal.aborted || zip.entryCount > policy.maxEntries) abort();
    else zip.readEntry();
  });
}

export async function checkArchiveBomb(
  bytes: Uint8Array,
  policy = defaultArchiveBombPolicy,
): Promise<StructureCheckResult> {
  if (!isZipLike(bytes))
    return hasArchiveSignature(Buffer.from(bytes)) ? invalid() : { ok: true, reason: null };
  try {
    const zip = await fromBufferPromise(Buffer.from(bytes), zipOptions);
    return await inspectZip(zip, policy, AbortSignal.timeout(30_000));
  } catch {
    return invalid();
  }
}

export async function checkArchiveFile(
  path: string,
  prefix: Buffer,
  size: number,
  policy = defaultArchiveBombPolicy,
  signal: AbortSignal = AbortSignal.timeout(30_000),
): Promise<StructureCheckResult> {
  if (signal.aborted) return invalid();
  if (!isZipLike(prefix)) {
    if (hasArchiveSignature(prefix)) return invalid();
    return { ok: size > 0, reason: size > 0 ? null : 'SCAN_STRUCTURE_INVALID:empty' };
  }
  try {
    const zip = await openPromise(path, zipOptions);
    const closed = new Promise<void>((resolve) => zip.once('close', resolve));
    try {
      return await inspectZip(zip, policy, signal);
    } finally {
      zip.close();
      await closed;
    }
  } catch {
    return invalid();
  }
}
export async function checkStructure(bytes: Uint8Array): Promise<StructureCheckResult> {
  return bytes.length
    ? checkArchiveBomb(bytes)
    : { ok: false, reason: 'SCAN_STRUCTURE_INVALID:empty' };
}

export function checkContentType(
  detected: string | null,
  declared: string | null,
  allowed: string[],
): boolean {
  if (allowed.length > 0 && (!detected || !allowed.includes(detected))) return false;
  return !detected || !declared || detected === declared.toLowerCase().split(';')[0]?.trim();
}
