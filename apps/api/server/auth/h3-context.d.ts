import type { CallerContext } from '@open-fms/database';
import type { Session } from './auth.ts';

declare module 'h3' {
  interface H3EventContext {
    user?: Session['user'];
    session?: Session['session'];
    caller?: CallerContext;
  }
}
