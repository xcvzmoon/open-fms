import { defineHandler } from 'nitro';
import { handleSignupSettings } from '../../../../../../registration/service.ts';

export default defineHandler(async () => {
  return await handleSignupSettings();
});
