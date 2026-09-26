import { defineHandler } from 'nitro';

export default defineHandler((event) => {
  return {
    userId: event.context.user?.id ?? null,
    email: event.context.user?.email ?? null,
  };
});
