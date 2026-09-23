import { defineClientAuth } from '@nuxtjs/better-auth/config';
import { emailOTPClient } from 'better-auth/client/plugins';

export default defineClientAuth({
  basePath: '/api/v1/auth',
  plugins: [emailOTPClient()],
});
