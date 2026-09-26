import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { handleSelfSignup, toRegistrationFailure } from '~/server/registration/service.ts';

const schema = v.object({
  name: v.pipe(v.string(), v.minLength(2), v.maxLength(64)),
  ownerEmail: v.pipe(v.string(), v.email()),
});

export default defineHandler(async (event) => {
  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('SIGNUP_INPUT_INVALID', { status: 400 });
  }
  try {
    return await handleSelfSignup(parsed.output);
  } catch (error) {
    const failure =
      error instanceof Error ? toRegistrationFailure(error) : { code: 'REGISTRATION_FAILED' };
    throw new HTTPError(failure.code, { status: 403 });
  }
});
