import type { CallerContext } from '@open-fms/database';
import { BlockList, isIP } from 'node:net';

export type ResourceScope = 'uploads:write' | 'files:read';

export function requiredScope(pathname: string, method: string): ResourceScope | null {
  if (pathname === '/api/v1/uploads' || pathname.startsWith('/api/v1/uploads/')) {
    return method === 'GET' || method === 'HEAD' ? 'files:read' : 'uploads:write';
  }
  if (pathname === '/api/v1/files' || pathname.startsWith('/api/v1/files/')) return 'files:read';
  return null;
}

export function cidrAllows(address: string, cidrs: string[]): boolean {
  if (cidrs.length === 0) return true;
  const family = isIP(address);
  if (!family) return false;
  const block = new BlockList();
  for (const cidr of cidrs) {
    const [network, prefix, extra] = cidr.split('/');
    if (!network || prefix === undefined || extra !== undefined || !/^\d+$/.test(prefix))
      return false;
    const networkFamily = isIP(network);
    if (!networkFamily) return false;
    try {
      block.addSubnet(network, Number(prefix), networkFamily === 4 ? 'ipv4' : 'ipv6');
    } catch {
      return false;
    }
  }
  return block.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export function smallerLimit(caller: number | null, credential: number | null): number | null {
  if (caller === null) return credential;
  if (credential === null) return caller;
  return Math.min(caller, credential);
}

export function applyCredentialPolicy(
  context: CallerContext,
  scope: ResourceScope | null,
  address: string,
): boolean {
  const { caller, credential } = context;
  if (!credential) return true;
  if (scope && !credential.scopes.includes(scope)) return false;
  if (!cidrAllows(address, credential.allowedCidrs)) return false;
  caller.maxFileSizeBytes = Math.min(
    caller.maxFileSizeBytes,
    credential.maxFileSizeBytes ?? caller.maxFileSizeBytes,
  );
  caller.rateLimitPerSec = smallerLimit(caller.rateLimitPerSec, credential.rateLimitPerSec);
  const restrictedTypes = credential.kind === 'restricted' || credential.allowedTypes.length > 0;
  if (restrictedTypes) {
    const allowed: string[] = [];
    for (const contentType of credential.allowedTypes) {
      if (
        caller.allowedContentTypes.length === 0 ||
        caller.allowedContentTypes.includes(contentType)
      )
        allowed.push(contentType);
    }
    if (allowed.length === 0 && scope === 'uploads:write') return false;
    caller.allowedContentTypes = allowed;
  }
  return true;
}

export function isTrustedMutation(
  headers: Headers,
  method: string,
  trustedOrigins: string[],
): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;
  const origin = headers.get('origin');
  if (!origin) return false;
  return trustedOrigins.some((trusted) => new URL(trusted).origin === origin);
}
