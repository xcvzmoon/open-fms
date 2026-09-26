import type { TokenPepper } from '@open-fms/database';
import { resolveAuthEnv } from './env.ts';

let pepper: TokenPepper | undefined;

export function getTokenPepper(): TokenPepper {
  if (!pepper) {
    const env = resolveAuthEnv();
    pepper = {
      secret: env.pepperSecret,
      version: env.pepperVersion,
    };
  }
  return pepper;
}
