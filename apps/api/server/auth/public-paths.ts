const publicPrefixes = ['/api/auth', '/api/v1/signup', '/healthz', '/readyz'];

export function isPublicRequest(pathname: string, method: string): boolean {
  if (method === 'OPTIONS') {
    return true;
  }
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
