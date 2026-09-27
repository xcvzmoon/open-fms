import { listUploadParts } from '@open-fms/database';
import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { loadOwnedFile, loadOwnedUploadSession } from '~/server/uploads/service.ts';

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
  const session = await loadOwnedUploadSession(fileId);
  const parts = await listUploadParts(session.id);
  return {
    fileId: file.id,
    status: file.status,
    rowVersion: file.rowVersion,
    sizeBytes: file.sizeBytes,
    objectKey: file.objectKey,
    mode: session.mode,
    uploadSessionId: session.id,
    multipartUploadId: session.multipartUploadId,
    receivedSizeBytes: session.receivedSizeBytes,
    partCount: session.partCount,
    uploadedParts: parts.map((part) => ({
      partNumber: part.partNumber,
      sizeBytes: part.sizeBytes,
      etag: part.etag,
    })),
  };
});
