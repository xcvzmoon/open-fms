import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { abortFile, loadOwnedFile } from '~/server/uploads/service.ts';

const schema = v.object({
  reason: v.optional(v.pipe(v.string(), v.maxLength(256)), 'client_abort'),
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
  const reason = parsed.success ? parsed.output.reason : 'client_abort';
  const file = await loadOwnedFile(fileId, caller.caller.id);
  if (file.status !== 'initiated' && file.status !== 'uploading') {
    throw new HTTPError('FILE_TRANSITION_INVALID', { status: 409 });
  }

  try {
    await abortFile({
      fileId: file.id,
      expectedStatus: file.status,
      expectedRowVersion: file.rowVersion,
      reason: reason ?? 'client_abort',
      reservedBytes: file.sizeBytes ?? 0,
    });
    return { fileId: file.id, status: 'failed', reason: reason ?? 'client_abort' };
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UPLOAD_ABORT_FAILED';
    throw new HTTPError(code, { status: 409 });
  }
});
