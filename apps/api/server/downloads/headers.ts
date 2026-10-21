export class DownloadRangeError extends Error {
  constructor() {
    super('DOWNLOAD_RANGE_INVALID');
  }
}

export function validateDownloadRange(range: string | undefined): string | undefined {
  if (range === undefined) return undefined;
  const match = /^bytes=(\d{1,16})?-(\d{1,16})?$/.exec(range);
  if (!match || match[0] !== range || (!match[1] && !match[2])) throw new DownloadRangeError();
  const start = match[1] ? Number(match[1]) : undefined;
  const end = match[2] ? Number(match[2]) : undefined;
  if (
    (start !== undefined && !Number.isSafeInteger(start)) ||
    (end !== undefined && !Number.isSafeInteger(end)) ||
    (start !== undefined && end !== undefined && start > end) ||
    (start === undefined && end === 0)
  )
    throw new DownloadRangeError();
  return range;
}

export function downloadDisposition(filename: string): string {
  // oxlint-disable-next-line no-control-regex -- Strip HTTP control characters from filenames.
  const safe = filename.replace(/[\u0000-\u001f\u007f/\\]/g, '_').toWellFormed();
  const fallback = safe.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(safe).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
