import type { DownloadCredentials } from './service.ts';

export function resolveDownloadCredentials(
  source: Record<string, string | undefined> = process.env,
): DownloadCredentials {
  const accessKeyId = source.STORAGE_ACCESS_KEY_ID;
  const secretAccessKey = source.STORAGE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_CREDENTIALS_REQUIRED');
  }
  return {
    accessKeyId,
    secretAccessKey,
    sessionToken: source.STORAGE_SESSION_TOKEN,
  };
}
