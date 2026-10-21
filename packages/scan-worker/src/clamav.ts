import type { Readable } from 'node:stream';
import { createConnection } from 'node:net';
import * as v from 'valibot';

export type ClamAvVerdict = {
  status: 'clean' | 'infected' | 'error';
  signature: string | null;
  detail: string | null;
};
export type ClamAvClient = {
  scanStream: (source: Readable, signal: AbortSignal) => Promise<ClamAvVerdict>;
};

export function createClamAvClient(options: {
  host: string;
  port: number;
  timeoutMs?: number;
}): ClamAvClient {
  return {
    scanStream(source, signal) {
      return new Promise((resolve) => {
        const socket = createConnection({ host: options.host, port: options.port });
        let response = '';
        let settled = false;
        const timer = setTimeout(() => {
          finish('error', 'SCAN_CLAMAV_TIMEOUT');
        }, options.timeoutMs ?? 30_000);
        function finish(status: ClamAvVerdict['status'], detail: string): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          source.destroy();
          socket.destroy();
          resolve({ status, signature: status === 'infected' ? detail : null, detail });
        }
        function abort(): void {
          finish('error', 'SCAN_ABORTED');
        }
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        function write(bytes: Buffer): Promise<void> {
          return new Promise((done, reject) => {
            socket.write(bytes, (error) => {
              if (error) reject(error);
              else done();
            });
          });
        }
        socket.on('connect', () => {
          void (async () => {
            await write(Buffer.from('zINSTREAM\0'));
            for await (const chunk of source) {
              const bytes = Buffer.from(v.parse(v.instance(Uint8Array), chunk));
              for (let offset = 0; offset < bytes.length; offset += 65536) {
                signal.throwIfAborted();
                const part = bytes.subarray(offset, offset + 65536);
                const header = Buffer.alloc(4);
                header.writeUInt32BE(part.length);
                await write(header);
                await write(part);
              }
            }
            await write(Buffer.alloc(4));
          })().catch(() => {
            finish('error', 'SCAN_CLAMAV_STREAM_ERROR');
          });
        });
        socket.on('data', (bytes: Buffer) => {
          response += bytes.toString('utf8');
          if (response.length > 4096) {
            finish('error', 'SCAN_CLAMAV_RESPONSE_LIMIT');
            return;
          }
          const end = response.indexOf('\0');
          if (end < 0) return;
          const line = response.slice(0, end);
          if (line === 'stream: OK') finish('clean', line);
          else if (/^stream: .+ FOUND$/.test(line)) finish('infected', line.slice(8, -6));
          else finish('error', 'SCAN_CLAMAV_INVALID_RESPONSE');
        });
        socket.on('end', () => {
          finish('error', 'SCAN_CLAMAV_TRUNCATED_RESPONSE');
        });
        socket.on('close', () => {
          finish('error', 'SCAN_CLAMAV_CLOSED');
        });
        socket.on('error', () => {
          finish('error', 'SCAN_CLAMAV_CONNECTION_ERROR');
        });
      });
    },
  };
}
