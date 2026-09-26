import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { handleRotateCredential, toRegistrationFailure } from '~/server/registration/service.ts';

const schema = v.object({
  newSecret: v.pipe(v.string(), v.minLength(32)),
});

export default defineHandler(async (event) => {
  const user = event.context.user;
  const callerId = event.context.params?.id;
  const keyId = event.context.params?.keyId;
  if (!user) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  if (!callerId || !keyId) {
    throw new HTTPError('ROUTE_PARAM_MISSING', { status: 400 });
  }
  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('ROTATE_INPUT_INVALID', { status: 400 });
  }
  try {
    await handleRotateCredential(user.id, callerId, keyId, parsed.output.newSecret);
  } catch (error) {
    const failure =
      error instanceof Error ? toRegistrationFailure(error) : { code: 'REGISTRATION_FAILED' };
    throw new HTTPError(failure.code, { status: 400 });
  }
  return { rotated: true };
});
