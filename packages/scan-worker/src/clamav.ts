export type ClamAvVerdict = {
  status: 'clean' | 'infected' | 'error';
  signature: string | null;
  detail: string | null;
};

export type ClamAvClient = {
  scanBuffer: (bytes: Uint8Array) => Promise<ClamAvVerdict>;
};

function parseClamResponse(chunk: string): ClamAvVerdict {
  const text = chunk.trim();
  if (text.endsWith('OK')) {
    return { status: 'clean', signature: null, detail: text };
  }
  if (text.includes('FOUND')) {
    const signature = text.split(' ').at(-2) ?? text;
    return { status: 'infected', signature, detail: text };
  }
  return { status: 'error', signature: null, detail: text };
}

export function createClamAvClient(options: {
  host: string;
  port: number;
  timeoutMs?: number;
}): ClamAvClient {
  return {
    async scanBuffer(bytes: Uint8Array): Promise<ClamAvVerdict> {
      const { createConnection } = await import('node:net');
      return new Promise((resolve) => {
        const socket = createConnection({ host: options.host, port: options.port });
        const chunks: Buffer[] = [];
        let settled = false;

        const finish = (verdict: ClamAvVerdict) => {
          if (settled) {
            return;
          }
          settled = true;
          socket.destroy();
          resolve(verdict);
        };

        socket.setTimeout(options.timeoutMs ?? 30_000);
        socket.on('connect', () => {
          socket.write(`INSTREAM\0`);
          let offset = 0;
          const chunkSize = 64 * 1024;
          while (offset < bytes.length) {
            const end = Math.min(offset + chunkSize, bytes.length);
            const slice = bytes.subarray(offset, end);
            const size = Buffer.alloc(4);
            size.writeUInt32BE(slice.length);
            socket.write(size);
            socket.write(Buffer.from(slice));
            offset = end;
          }
          socket.write(Buffer.alloc(4));
        });
        socket.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        socket.on('end', () => {
          finish(parseClamResponse(Buffer.concat(chunks).toString('utf8')));
        });
        socket.on('timeout', () => {
          finish({ status: 'error', signature: null, detail: 'timeout' });
        });
        socket.on('error', (error: Error) => {
          finish({ status: 'error', signature: null, detail: error.message });
        });
      });
    },
  };
}
