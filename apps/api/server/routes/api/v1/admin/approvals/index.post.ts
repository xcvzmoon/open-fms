import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { handleAdminApproval, toRegistrationFailure } from '~/server/registration/service.ts';

const schema = v.object({
  callerId: v.pipe(v.string(), v.minLength(1)),
  approve: v.boolean(),
});

export default defineHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('APPROVAL_INPUT_INVALID', { status: 400 });
  }
  try {
    return await handleAdminApproval(user.id, parsed.output);
  } catch (error) {
    const failure =
      error instanceof Error ? toRegistrationFailure(error) : { code: 'REGISTRATION_FAILED' };
    throw new HTTPError(failure.code, { status: 400 });
  }
});
