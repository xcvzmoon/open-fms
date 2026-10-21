import { isIP } from 'node:net';

export const clientIpHeader = 'x-fms-client-ip';

export function createAuthRequest(request: Request, clientAddress: string | undefined): Request {
  if (!clientAddress || isIP(clientAddress) === 0) throw new Error('AUTH_CLIENT_IP_REQUIRED');
  const headers = new Headers(request.headers);
  headers.delete(clientIpHeader);
  headers.set(clientIpHeader, clientAddress);
  return new Request(request, { headers });
}
