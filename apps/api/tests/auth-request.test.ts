import { Readable } from 'node:stream';
import { describe, expect, test } from 'vite-plus/test';
import { readBootstrapPassword } from '../server/auth/bootstrap-password.ts';
import { clientIpHeader, createAuthRequest } from '../server/auth/request.ts';

describe('trusted auth request address', () => {
  test('overwrites client address headers without changing the URL, origin or request body', async () => {
    const original = new Request('https://fms.example/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        origin: 'https://app.example',
        'content-type': 'application/json',
        [clientIpHeader]: '203.0.113.99',
        'x-forwarded-for': '203.0.113.99',
        'x-real-ip': '203.0.113.99',
      },
      body: JSON.stringify({ email: 'operator@example.test', password: 'dummy-password' }),
    });
    const request = createAuthRequest(original, '192.0.2.1');
    expect(request.headers.get(clientIpHeader)).toBe('192.0.2.1');
    expect(original.headers.get(clientIpHeader)).toBe('203.0.113.99');
    expect(request.headers.get('origin')).toBe('https://app.example');
    expect(request.url).toBe(original.url);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({
      email: 'operator@example.test',
      password: 'dummy-password',
    });
  });
  test('fails closed when the server cannot supply an IP address', () => {
    for (const address of [undefined, '', 'untrusted', '192.0.2.1, 203.0.113.1']) {
      expect(() =>
        createAuthRequest(
          new Request('https://fms.example/api/auth/ok', {
            headers: { [clientIpHeader]: '192.0.2.1' },
          }),
          address,
        ),
      ).toThrow('AUTH_CLIENT_IP_REQUIRED');
    }
  });
});

describe('operator password input', () => {
  test('reads a password from stdin without trimming its contents', async () => {
    await expect(readBootstrapPassword(Readable.from([' secure password \n']))).resolves.toBe(
      ' secure password ',
    );
  });
  test('rejects missing or invalid password input', async () => {
    await expect(readBootstrapPassword(Readable.from([]))).rejects.toThrow(
      'BOOTSTRAP_PASSWORD_REQUIRED',
    );
    await expect(readBootstrapPassword(Readable.from(['short\n']))).rejects.toThrow(
      'BOOTSTRAP_PASSWORD_LENGTH_INVALID',
    );
    await expect(readBootstrapPassword(Readable.from(['x'.repeat(129)]))).rejects.toThrow(
      'BOOTSTRAP_PASSWORD_LENGTH_INVALID',
    );
  });
});
