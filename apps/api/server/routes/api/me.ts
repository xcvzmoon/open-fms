import { defineHandler } from 'nitro';
import { HTTPError } from 'nitro/h3';
import * as v from 'valibot';

const authUserSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  email: v.pipe(v.string(), v.email()),
});

export default defineHandler((event) => {
  const parsed = v.safeParse(authUserSchema, event.context.user);
  if (!parsed.success) {
    throw new HTTPError('Unauthorized', { status: 401 });
  }
  return {
    userId: parsed.output.id,
    email: parsed.output.email,
  };
});
