import { defineHandler } from 'nitro';
import { handleSignupSettings } from '~/server/registration/service.ts';

export default defineHandler(async () => {
  return await handleSignupSettings();
});
