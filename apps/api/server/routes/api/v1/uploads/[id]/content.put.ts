import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { resolveUploadCredentials } from '~/server/uploads/credentials.ts';
import { hashBuffer } from '~/server/uploads/hash.ts';
import {
  completeAndEnqueueScan,
  loadOwnedFile,
  markUploading,
  resolveStorageAdapter,
} from '~/server/uploads/service.ts';

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
  if (file.status === 'initiated') {
    await markUploading({ fileId: file.id, expectedRowVersion: file.rowVersion });
  }

  const body = event.req.body;
  const chunks: Uint8Array[] = [];
  if (!body) {
    throw new HTTPError('UPLOAD_BODY_MISSING', { status: 400 });
  }
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  const payload = Buffer.concat(chunks);
  const hashed = hashBuffer(payload);

  const storage = await resolveStorageAdapter(file.storageBackendId, resolveUploadCredentials());
  try {
    const put = await storage.putObject({
      location: {
        bucket: storage.quarantineBucket,
        key: file.objectKey,
      },
      body: payload,
      contentType: event.req.headers.get('content-type') ?? undefined,
      contentLength: hashed.sizeBytes,
    });

    const next = await completeAndEnqueueScan({
      fileId: file.id,
      expectedRowVersion: file.status === 'initiated' ? file.rowVersion + 1 : file.rowVersion,
      checksumSha256: hashed.sha256,
      sizeBytes: hashed.sizeBytes,
      etag: put.etag,
      sealedEtag: put.etag,
      detectedContentType: event.req.headers.get('content-type') ?? null,
    });

    return {
      fileId: file.id,
      status: next.status,
      sizeBytes: hashed.sizeBytes,
      checksumSha256: hashed.sha256.toString('base64url'),
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UPLOAD_CONTENT_FAILED';
    throw new HTTPError(code, { status: 400 });
  } finally {
    storage.destroy();
  }
});
