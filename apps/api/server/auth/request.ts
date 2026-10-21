import { isIP } from 'node:net';

export const clientIpHeader = 'x-fms-client-ip';

export function createAuthRequest(request: Request, clientAddress: string | undefined): Request {
  if (!clientAddress || isIP(clientAddress) === 0) throw new Error('AUTH_CLIENT_IP_REQUIRED');
  const trustedRequest = request.clone();
  trustedRequest.headers.set(clientIpHeader, clientAddress);
  return trustedRequest;
}
