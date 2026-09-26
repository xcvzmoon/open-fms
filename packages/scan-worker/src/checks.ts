import { createHash } from 'node:crypto';

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

export function countZipLocalHeaders(bytes: Uint8Array): number {
  let count = 0;
  for (let index = 0; index + 3 < bytes.length; index += 1) {
    if (
      bytes[index] === 0x50 &&
      bytes[index + 1] === 0x4b &&
      bytes[index + 2] === 0x03 &&
      bytes[index + 3] === 0x04
    ) {
      count += 1;
    }
  }
  return count;
}

export type ArchiveBombPolicy = {
  maxEntries: number;
  maxDeclaredUncompressedBytes: number;
};

export const defaultArchiveBombPolicy: ArchiveBombPolicy = {
  maxEntries: 10_000,
  maxDeclaredUncompressedBytes: 4 * 1024 * 1024 * 1024,
};

export function checkArchiveBomb(
  bytes: Uint8Array,
  policy: ArchiveBombPolicy = defaultArchiveBombPolicy,
): StructureCheckResult {
  if (!isZipLike(bytes)) {
    return { ok: true, reason: null };
  }

  const entries = countZipLocalHeaders(bytes);
  if (entries > policy.maxEntries) {
    return { ok: false, reason: `SCAN_ARCHIVE_BOMB:entries:${entries}` };
  }

  const ratio = bytes.length === 0 ? 0 : (entries * 64_000) / bytes.length;
  if (entries > 32 && ratio > 200) {
    return { ok: false, reason: `SCAN_ARCHIVE_BOMB:ratio:${ratio.toFixed(1)}` };
  }

  return { ok: true, reason: null };
}

export function checkStructure(bytes: Uint8Array): StructureCheckResult {
  if (bytes.length === 0) {
    return { ok: false, reason: 'SCAN_STRUCTURE_INVALID:empty' };
  }
  return checkArchiveBomb(bytes);
}
