import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { resolveUploadCredentials } from '~/server/uploads/credentials.ts';
import {
  loadOwnedFile,
  loadOwnedUploadSession,
  markUploading,
  resolveStorageAdapter,
  storeResumablePart,
} from '~/server/uploads/service.ts';

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  const fileId = event.context.params?.id;
  const partNumberRaw = event.context.params?.n;
  if (!caller) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  if (!fileId || !partNumberRaw) {
    throw new HTTPError('ROUTE_PARAM_MISSING', { status: 400 });
  }
  const partNumber = Number.parseInt(partNumberRaw, 10);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
    throw new HTTPError('UPLOAD_PART_NUMBER_INVALID', { status: 400 });
  }

  const file = await loadOwnedFile(fileId, caller.caller.id);
  const session = await loadOwnedUploadSession(fileId);
  if (session.mode === 'proxy_single') {
    throw new HTTPError('UPLOAD_MODE_INVALID', { status: 409 });
  }
  if (file.status === 'initiated') {
    await markUploading({ fileId: file.id, expectedRowVersion: file.rowVersion });
    file.status = 'uploading';
    file.rowVersion += 1;
  }
  if (file.status !== 'uploading') {
    throw new HTTPError('FILE_TRANSITION_INVALID', { status: 409 });
  }

  const body = event.req.body;
  if (!body) {
    throw new HTTPError('UPLOAD_BODY_MISSING', { status: 400 });
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  const payload = Buffer.concat(chunks);

  const storage = await resolveStorageAdapter(file.storageBackendId, resolveUploadCredentials());
  try {
    const stored = await storeResumablePart({
      session,
      storage,
      objectKey: file.objectKey,
      partNumber,
      payload,
    });
    return {
      fileId: file.id,
      partNumber,
      sizeBytes: stored.sizeBytes,
      etag: stored.etag,
      checksumSha256: stored.checksumSha256,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UPLOAD_PART_FAILED';
    throw new HTTPError(code, { status: 400 });
  } finally {
    storage.destroy();
  }
});
