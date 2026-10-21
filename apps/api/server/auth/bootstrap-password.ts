import type { Readable } from 'node:stream';
import { createInterface } from 'node:readline';

export async function readBootstrapPassword(input: Readable): Promise<string> {
  const lines = createInterface({ input, terminal: false, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length < 12 || line.length > 128)
        throw new Error('BOOTSTRAP_PASSWORD_LENGTH_INVALID');
      return line;
    }
    throw new Error('BOOTSTRAP_PASSWORD_REQUIRED');
  } finally {
    lines.close();
  }
}
