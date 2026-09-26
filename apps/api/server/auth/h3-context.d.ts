import type { Session } from '../auth/auth.ts';

declare module 'h3' {
  interface H3EventContext {
    user?: Session['user'];
    session?: Session['session'];
  }
}

export {};
