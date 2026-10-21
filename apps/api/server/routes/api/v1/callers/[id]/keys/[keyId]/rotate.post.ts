import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { handleRotateCredential, toRegistrationFailure } from '~/server/registration/service.ts';

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
  try {
    return await handleRotateCredential(user.id, callerId, keyId);
  } catch (error) {
    const failure =
      error instanceof Error ? toRegistrationFailure(error) : { code: 'REGISTRATION_FAILED' };
    throw new HTTPError(failure.code, { status: 400 });
  }
});
