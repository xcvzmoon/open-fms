import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { handleRedeemSetupCode, toRegistrationFailure } from '~/server/registration/service.ts';

const schema = v.object({
  code: v.pipe(v.string(), v.minLength(32)),
});

export default defineHandler(async (event) => {
  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('SETUP_CODE_INPUT_INVALID', { status: 400 });
  }
  try {
    return await handleRedeemSetupCode(parsed.output);
  } catch (error) {
    const failure =
      error instanceof Error ? toRegistrationFailure(error) : { code: 'REGISTRATION_FAILED' };
    throw new HTTPError(failure.code, { status: 400 });
  }
});
