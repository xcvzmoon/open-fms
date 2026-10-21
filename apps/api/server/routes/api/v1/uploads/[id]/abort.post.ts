import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { resolveUploadCredentials } from '~/server/uploads/credentials.ts';
import { uploadFailure } from '~/server/uploads/errors.ts';
import { withUploadLock } from '~/server/uploads/lock.ts';
import {
  loadOwnedFile,
  loadOwnedUploadSession,
  resolveStorageAdapter,
  abortFile,
  abortResumableUpload,
} from '~/server/uploads/service.ts';

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  const fileId = event.context.params?.id;
  if (!caller) throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  if (!fileId) throw new HTTPError('ROUTE_PARAM_MISSING', { status: 400 });
  const signal = AbortSignal.any([event.req.signal, AbortSignal.timeout(120_000)]);
  try {
    return await withUploadLock(fileId, caller.caller.id, async () => {
      const file = await loadOwnedFile(fileId, caller.caller.id);
      const session = await loadOwnedUploadSession(fileId);
      if (file.status !== 'initiated' && file.status !== 'uploading')
        throw new Error('FILE_TRANSITION_INVALID');
      const storage = session.multipartUploadId
        ? await resolveStorageAdapter(file.storageBackendId, resolveUploadCredentials())
        : null;
      try {
        await abortResumableUpload({
          session,
          storage,
          objectKey: file.objectKey,
          signal,
        });
        await abortFile({
          fileId,
          expectedStatus: file.status,
          expectedRowVersion: file.rowVersion,
          reason: 'client_abort',
        });
        return { fileId, status: 'failed', reason: 'client_abort' };
      } finally {
        storage?.destroy();
      }
    });
  } catch (error) {
    throw uploadFailure(error instanceof Error ? error : new Error('UPLOAD_FAILED'));
  }
});
