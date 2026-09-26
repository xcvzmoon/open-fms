import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { resolveUploadCredentials } from '~/server/uploads/credentials.ts';
import { hashBuffer } from '~/server/uploads/hash.ts';
import { loadOwnedFile, markUploading, resolveStorageAdapter } from '~/server/uploads/service.ts';

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
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new HTTPError('UPLOAD_PART_NUMBER_INVALID', { status: 400 });
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
        key: `${file.objectKey}.part.${partNumber}`,
      },
      body: payload,
      contentLength: hashed.sizeBytes,
    });
    return {
      fileId: file.id,
      partNumber,
      sizeBytes: hashed.sizeBytes,
      etag: put.etag,
      checksumSha256: hashed.sha256.toString('base64url'),
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UPLOAD_PART_FAILED';
    throw new HTTPError(code, { status: 400 });
  } finally {
    storage.destroy();
  }
});
