import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { resolveUploadCredentials } from '~/server/uploads/credentials.ts';
import {
  completeAndEnqueueScan,
  loadOwnedFile,
  loadOwnedUploadSession,
  resolveStorageAdapter,
  sealResumableUpload,
} from '~/server/uploads/service.ts';

const schema = v.object({
  checksumSha256: v.optional(v.pipe(v.string(), v.minLength(43))),
  sizeBytes: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  etag: v.optional(v.pipe(v.string(), v.minLength(1))),
  sealedEtag: v.optional(v.pipe(v.string(), v.minLength(1))),
  detectedContentType: v.optional(v.nullable(v.string())),
});

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  const fileId = event.context.params?.id;
  if (!caller) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  if (!fileId) {
    throw new HTTPError('ROUTE_PARAM_MISSING', { status: 400 });
  }

  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('UPLOAD_COMPLETE_INPUT_INVALID', { status: 400 });
  }

  const file = await loadOwnedFile(fileId, caller.caller.id);
  const session = await loadOwnedUploadSession(fileId);
  if (file.status !== 'uploading') {
    throw new HTTPError('FILE_TRANSITION_INVALID', { status: 409 });
  }

  if (session.mode === 'proxy_parts') {
    const storage = await resolveStorageAdapter(file.storageBackendId, resolveUploadCredentials());
    try {
      const sealed = await sealResumableUpload({ file, session, storage });
      return {
        fileId: file.id,
        status: sealed.status,
        rowVersion: sealed.rowVersion,
        sizeBytes: sealed.sizeBytes,
        checksumSha256: sealed.checksumSha256,
        etag: sealed.etag,
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : 'UPLOAD_COMPLETE_FAILED';
      throw new HTTPError(code, { status: 409 });
    } finally {
      storage.destroy();
    }
  }

  const { checksumSha256, sizeBytes, etag, sealedEtag, detectedContentType } = parsed.output;
  if (!checksumSha256 || sizeBytes === undefined || !etag || !sealedEtag) {
    throw new HTTPError('UPLOAD_COMPLETE_INPUT_INVALID', { status: 400 });
  }

  try {
    const result = await completeAndEnqueueScan({
      fileId: file.id,
      expectedRowVersion: file.rowVersion,
      checksumSha256: Buffer.from(checksumSha256, 'base64url'),
      sizeBytes,
      etag,
      sealedEtag,
      detectedContentType: detectedContentType ?? null,
    });
    return {
      fileId: file.id,
      status: result.status,
      rowVersion: result.rowVersion,
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UPLOAD_COMPLETE_FAILED';
    throw new HTTPError(code, { status: 409 });
  }
});
