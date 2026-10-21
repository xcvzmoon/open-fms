import { HTTPError } from 'nitro/h3';

const inputErrors = new Set([
  'UPLOAD_BODY_MISSING',
  'UPLOAD_SIZE_MISMATCH',
  'UPLOAD_LIMIT_INVALID',
  'UPLOAD_PART_TOO_LARGE',
  'UPLOAD_PART_NUMBER_INVALID',
  'UPLOAD_PARTS_MISSING',
  'UPLOAD_PART_SEQUENCE_INVALID',
  'UPLOAD_PART_TOO_SMALL',
  'UPLOAD_BODY_INCOMPLETE',
]);
const conflictErrors = new Set([
  'UPLOAD_SESSION_INVALID',
  'UPLOAD_MODE_INVALID',
  'UPLOAD_BUSY',
  'FILE_TRANSITION_INVALID',
  'FILE_ROW_VERSION_CONFLICT',
  'UPLOAD_MULTIPART_MISSING',
  'STORAGE_SEAL_MISMATCH',
]);
export function uploadFailure(error: Error): HTTPError {
  if (error instanceof HTTPError) return error;
  const code = error.message;
  if (inputErrors.has(code)) return new HTTPError(code, { status: 400 });
  if (conflictErrors.has(code)) return new HTTPError(code, { status: 409 });
  if (code === 'QUOTA_EXCEEDED') return new HTTPError(code, { status: 413 });
  if (code === 'FILE_NOT_FOUND') return new HTTPError(code, { status: 404 });
  if (code === 'CALLER_NOT_ACTIVE' || code === 'UPLOAD_TYPE_NOT_ALLOWED')
    return new HTTPError(code, { status: 403 });
  if (code === 'UPLOAD_CAPACITY_EXCEEDED') return new HTTPError(code, { status: 503 });
  if (error.name === 'AbortError' || error.name === 'TimeoutError')
    return new HTTPError('UPLOAD_INTERRUPTED', { status: 408 });
  return new HTTPError('UPLOAD_FAILED', { status: 500 });
}
