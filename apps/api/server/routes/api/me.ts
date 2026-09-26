import { defineHandler } from 'nitro';

type AuthenticatedUser = {
  id: string;
  email: string;
};

export default defineHandler((event) => {
  // SAFETY: middleware/auth.ts assigns the Better Auth session user before non-public handlers run.
  const user = event.context.user as AuthenticatedUser | undefined;
  return {
    userId: user?.id ?? null,
    email: user?.email ?? null,
  };
});
