import { defineHandler } from 'nitro';

export default defineHandler(() => {
  return {
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
  };
});
