import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

export async function ephemeralPort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
  try {
    const address = listener.address();
    if (!address || !(address instanceof Object)) throw new Error('HTTP_FIXTURE_ADDRESS_INVALID');
    return address.port;
  } finally {
    await new Promise<void>((resolve, reject) =>
      listener.close((error) => {
        if (error) reject(error);
        else resolve();
      }),
    );
  }
}

export async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 1000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}
