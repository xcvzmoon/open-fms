import { defineHandler } from 'nitro';
import { auth } from '~/server/utils/auth.ts';

export default defineHandler(async (event) => {
  return auth.handler(event.req);
});
