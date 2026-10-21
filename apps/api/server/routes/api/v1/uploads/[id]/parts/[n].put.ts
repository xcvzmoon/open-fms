import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { readPartBody } from '~/server/uploads/body.ts';
import { resolveUploadCredentials } from '~/server/uploads/credentials.ts';
import { uploadFailure } from '~/server/uploads/errors.ts';
import { withUploadLock } from '~/server/uploads/lock.ts';
import {
  loadOwnedFile,
  loadOwnedUploadSession,
  resolveStorageAdapter,
  assertUploadOpen,
  assertUploadPolicy,
  markUploading,
  loadPreviousPartSize,
  parsePartNumber,
  storeResumablePart,
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
      const partNumber = parsePartNumber(event.context.params?.n ?? '');
      assertUploadOpen(file, session, 'proxy_parts');
      const size = session.declaredSizeBytes;
      assertUploadPolicy(caller, size, session.declaredContentType);
      if (!event.req.body) throw new Error('UPLOAD_BODY_MISSING');
      const previousSize = await loadPreviousPartSize(session.id, partNumber);
      const maximum = Math.min(16 * 1024 * 1024, size - session.receivedSizeBytes + previousSize);
      const payload = await readPartBody(event.req.body, maximum, signal);
      if (file.status === 'initiated')
        await markUploading({ fileId, expectedRowVersion: file.rowVersion });
      const storage = await resolveStorageAdapter(
        file.storageBackendId,
        resolveUploadCredentials(),
      );
      try {
        const stored = await storeResumablePart({
          session,
          storage,
          objectKey: file.objectKey,
          partNumber,
          payload,
          signal,
        });
        return { fileId, partNumber, ...stored };
      } finally {
        storage.destroy();
      }
    });
  } catch (error) {
    throw uploadFailure(error instanceof Error ? error : new Error('UPLOAD_FAILED'));
  }
});
