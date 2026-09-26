import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { startUpload } from '~/server/uploads/service.ts';

const schema = v.object({
  storageBackendId: v.pipe(v.string(), v.minLength(1)),
  originalFilename: v.pipe(v.string(), v.minLength(1), v.maxLength(255)),
  declaredContentType: v.optional(v.nullable(v.string())),
  declaredSizeBytes: v.optional(v.nullable(v.pipe(v.number(), v.integer(), v.minValue(0)))),
  idempotencyKey: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(255)))),
  mode: v.optional(v.picklist(['proxy_single', 'proxy_parts', 'direct']), 'proxy_single'),
});

export default defineHandler(async (event) => {
  const caller = event.context.caller;
  if (!caller?.caller || caller.caller.status !== 'active') {
    throw new HTTPError('CALLER_NOT_ACTIVE', { status: 403 });
  }
  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('UPLOAD_CREATE_INPUT_INVALID', { status: 400 });
  }
  try {
    return await startUpload({
      callerId: caller.caller.id,
      storageBackendId: parsed.output.storageBackendId,
      originalFilename: parsed.output.originalFilename,
      declaredContentType: parsed.output.declaredContentType ?? null,
      declaredSizeBytes: parsed.output.declaredSizeBytes ?? null,
      idempotencyKey: parsed.output.idempotencyKey ?? null,
      mode: parsed.output.mode ?? 'proxy_single',
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UPLOAD_CREATE_FAILED';
    throw new HTTPError(code, { status: code === 'QUOTA_EXCEEDED' ? 413 : 400 });
  }
});
