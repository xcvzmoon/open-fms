import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { completeAndEnqueueScan, loadOwnedFile } from '~/server/uploads/service.ts';

const schema = v.object({
  checksumSha256: v.pipe(v.string(), v.minLength(43)),
  sizeBytes: v.pipe(v.number(), v.integer(), v.minValue(0)),
  etag: v.pipe(v.string(), v.minLength(1)),
  sealedEtag: v.pipe(v.string(), v.minLength(1)),
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
  if (file.status !== 'uploading') {
    throw new HTTPError('FILE_TRANSITION_INVALID', { status: 409 });
  }

  const checksum = Buffer.from(parsed.output.checksumSha256, 'base64url');

  try {
    const result = await completeAndEnqueueScan({
      fileId: file.id,
      expectedRowVersion: file.rowVersion,
      checksumSha256: checksum,
      sizeBytes: parsed.output.sizeBytes,
      etag: parsed.output.etag,
      sealedEtag: parsed.output.sealedEtag,
      detectedContentType: parsed.output.detectedContentType ?? null,
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
