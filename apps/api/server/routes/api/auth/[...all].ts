import { defineHandler } from 'nitro';
import { toRequest } from 'nitro/h3';
import { auth } from '../../../auth/auth.ts';

export default defineHandler(async (event) => {
  return await auth.handler(toRequest(event.req));
});
