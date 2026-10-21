import type { Socket } from 'node:net';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSecureContext, TLSSocket } from 'node:tls';
import * as v from 'valibot';
import { expect, test } from 'vite-plus/test';
import { createMailDispatch } from '../src/index.ts';

const resetUrl = 'https://example.invalid/reset?token=dummy-smtp-regression';

test.each(['missing-starttls', 'untrusted-certificate'] as const)(
  'rejects SMTP with %s before sending authentication mail',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'fms-smtp-test-'));
    const sockets = new Set<Socket>();
    const commands: string[] = [];
    let received = '';
    let upgraded = false;
    let tlsEstablished = false;
    const server = createServer();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const keyPath = join(directory, 'key.pem');
      const certificatePath = join(directory, 'certificate.pem');
      execFileSync(
        'openssl',
        [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-nodes',
          '-days',
          '1',
          '-subj',
          '/CN=localhost',
          '-addext',
          'subjectAltName=DNS:localhost',
          '-keyout',
          keyPath,
          '-out',
          certificatePath,
        ],
        { timeout: 5000, stdio: 'ignore', env: { PATH: '/usr/bin:/bin' } },
      );
      const context = createSecureContext({
        key: await readFile(keyPath),
        cert: await readFile(certificatePath),
      });

      function track(socket: Socket): void {
        sockets.add(socket);
        socket.on('error', () => {});
        socket.on('close', () => sockets.delete(socket));
        socket.setTimeout(2000, () => socket.destroy());
      }

      function readCommands(socket: Socket): void {
        let pending = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk: string) => {
          received += chunk;
          pending += chunk;
          if (received.length > 8192) {
            socket.destroy();
            return;
          }
          let end = pending.indexOf('\r\n');
          while (end !== -1) {
            const command = pending.slice(0, end);
            pending = pending.slice(end + 2);
            commands.push(command);
            if (command.startsWith('EHLO')) {
              socket.write(
                scenario === 'missing-starttls'
                  ? '250 localhost\r\n'
                  : '250-localhost\r\n250 STARTTLS\r\n',
              );
            } else if (command === 'STARTTLS') {
              upgraded = true;
              socket.removeAllListeners('data');
              socket.write('220 Begin TLS\r\n');
              const encrypted = new TLSSocket(socket, { isServer: true, secureContext: context });
              track(encrypted);
              encrypted.on('secure', () => {
                tlsEstablished = true;
              });
              readCommands(encrypted);
              return;
            } else {
              socket.write(command === 'DATA' ? '354 Send message\r\n' : '250 OK\r\n');
            }
            end = pending.indexOf('\r\n');
          }
        });
      }

      server.on('connection', (socket) => {
        track(socket);
        readCommands(socket);
        socket.write('220 localhost dummy SMTP\r\n');
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = v.parse(v.object({ port: v.number() }), server.address());
      const dispatch = createMailDispatch({
        mode: 'smtp',
        from: 'sender@example.invalid',
        smtpHost: 'localhost',
        smtpPort: address.port,
      });
      const timeout = new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => {
          for (const socket of sockets) socket.destroy();
          reject(new Error('SMTP_FIXTURE_DEADLINE'));
        }, 3000);
      });
      await expect(
        Promise.race([
          dispatch.notify({
            type: 'auth.password-reset',
            email: 'recipient@example.invalid',
            resetUrl,
          }),
          timeout,
        ]),
      ).rejects.toThrow(
        scenario === 'missing-starttls' ? /STARTTLS required/ : /self.signed certificate/i,
      );
      expect(commands.some((command) => command.startsWith('EHLO'))).toBe(true);
      expect(upgraded).toBe(scenario === 'untrusted-certificate');
      expect(tlsEstablished).toBe(false);
      expect(commands.some((command) => /^(?:MAIL FROM|RCPT TO|DATA)/i.test(command))).toBe(false);
      expect(received).not.toContain(resetUrl);
      expect(received).not.toContain('dummy-smtp-regression');
    } finally {
      clearTimeout(deadline);
      for (const socket of sockets) socket.destroy();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      await rm(directory, { recursive: true, force: true });
    }
  },
  12000,
);
