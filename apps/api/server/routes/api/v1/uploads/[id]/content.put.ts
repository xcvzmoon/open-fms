import { defineHandler } from 'nitro';
import { HTTPError, assertBodySize } from 'nitro/h3';
import { hashUploadBody } from '~/server/uploads/body.ts';
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
  assertUploadHeaders,
  completeAndEnqueueScan,
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
      assertUploadOpen(file, session, 'proxy_single');
      const size = session.declaredSizeBytes;
      assertUploadPolicy(caller, size, session.declaredContentType);
      assertUploadHeaders(event.req.headers, size, session.declaredContentType);
      assertBodySize(event, size);
      if (!event.req.body) throw new Error('UPLOAD_BODY_MISSING');
      if (file.status === 'initiated') {
        await markUploading({ fileId, expectedRowVersion: file.rowVersion });
        file.rowVersion += 1;
      }
      const storage = await resolveStorageAdapter(
        file.storageBackendId,
        resolveUploadCredentials(),
      );
      const hashedBody = hashUploadBody(event.req.body, size, signal);
      try {
        const put = await storage.putObject({
          location: { bucket: storage.quarantineBucket, key: file.objectKey },
          body: hashedBody.body,
          contentLength: size,
          contentType: session.declaredContentType ?? undefined,
          abortSignal: signal,
        });
        const hashed = hashedBody.result();
        const next = await completeAndEnqueueScan({
          fileId,
          expectedRowVersion: file.rowVersion,
          checksumSha256: hashed.sha256,
          sizeBytes: hashed.sizeBytes,
          etag: put.etag,
          sealedEtag: put.etag,
          detectedContentType: null,
        });
        return {
          fileId,
          status: next.status,
          sizeBytes: hashed.sizeBytes,
          checksumSha256: hashed.sha256.toString('base64url'),
        };
      } finally {
        hashedBody.body.destroy();
        storage.destroy();
      }
    });
  } catch (error) {
    throw uploadFailure(error instanceof Error ? error : new Error('UPLOAD_FAILED'));
  }
});
