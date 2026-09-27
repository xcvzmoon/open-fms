import { loadFileById } from '@open-fms/database';
import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  const fileId = event.context.params?.id;
  if (!caller) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  if (!fileId) {
    throw new HTTPError('ROUTE_PARAM_MISSING', { status: 400 });
  }

  const file = await loadFileById(fileId);
  if (!file || file.callerId !== caller.caller.id) {
    throw new HTTPError('FILE_NOT_FOUND', { status: 404 });
  }

  return {
    fileId: file.id,
    status: file.status,
    sizeBytes: file.sizeBytes,
    checksumSha256: file.checksumSha256?.toString('base64url') ?? null,
    objectKey: file.objectKey,
    rowVersion: file.rowVersion,
  };
});
