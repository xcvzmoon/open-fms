import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import { handleResendSetupCode } from '~/server/registration/service.ts';

export default defineHandler(async (event) => {
  const user = event.context.user;
  if (!user) throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  return handleResendSetupCode(user.id);
});
