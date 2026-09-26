import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { loadOwnedFile } from '~/server/uploads/service.ts';

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  const fileId = event.context.params?.id;
  if (!caller) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  if (!fileId) {
    throw new HTTPError('ROUTE_PARAM_MISSING', { status: 400 });
  }
  const file = await loadOwnedFile(fileId, caller.caller.id);
  return {
    fileId: file.id,
    status: file.status,
    rowVersion: file.rowVersion,
    sizeBytes: file.sizeBytes,
    objectKey: file.objectKey,
  };
});
