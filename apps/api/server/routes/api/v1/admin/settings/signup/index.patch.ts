import { defineHandler } from 'nitro';
import { HTTPError, readBody } from 'nitro/h3';
import * as v from 'valibot';
import { handleSaveSignupSettings } from '~/server/registration/service.ts';

const schema = v.object({
  mode: v.picklist(['disabled', 'admin_approval', 'self_signup']),
  allowedDomains: v.array(v.pipe(v.string(), v.minLength(1))),
  requireAdminApproval: v.boolean(),
  maxPendingDays: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export default defineHandler(async (event) => {
  const user = event.context.user;
  if (!user) {
    throw new HTTPError('AUTH_REQUIRED', { status: 401 });
  }
  const parsed = v.safeParse(schema, await readBody(event));
  if (!parsed.success) {
    throw new HTTPError('SIGNUP_SETTINGS_INVALID', { status: 400 });
  }
  await handleSaveSignupSettings(user.id, parsed.output);
  return { ok: true };
});
