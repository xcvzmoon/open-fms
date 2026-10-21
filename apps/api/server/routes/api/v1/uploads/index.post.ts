import { defineHandler, defineRouteMeta } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { uploadFailure } from '~/server/uploads/errors.ts';
import { assertUploadPolicy, createUploadSchema, startUpload } from '~/server/uploads/service.ts';

defineRouteMeta({
  openAPI: {
    tags: ['uploads'],
    summary: 'Create upload',
    description: 'Creates a file and upload session and reserves quota.',
    responses: {
      200: { description: 'Upload created' },
      403: { description: 'Caller not active' },
      413: { description: 'Quota exceeded' },
    },
  },
});

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  if (!caller?.caller || caller.caller.status !== 'active') {
    throw new HTTPError('CALLER_NOT_ACTIVE', { status: 403 });
  }
  const parsed = v.safeParse(createUploadSchema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('UPLOAD_CREATE_INPUT_INVALID', { status: 400 });
  }
  try {
    assertUploadPolicy(
      caller,
      parsed.output.declaredSizeBytes,
      parsed.output.declaredContentType ?? null,
    );
    return await startUpload({
      callerId: caller.caller.id,
      storageBackendId: parsed.output.storageBackendId,
      originalFilename: parsed.output.originalFilename,
      declaredContentType: parsed.output.declaredContentType ?? null,
      declaredSizeBytes: parsed.output.declaredSizeBytes,
      idempotencyKey: parsed.output.idempotencyKey ?? null,
      mode: parsed.output.mode,
    });
  } catch (error) {
    throw uploadFailure(error instanceof Error ? error : new Error('UPLOAD_FAILED'));
  }
});
