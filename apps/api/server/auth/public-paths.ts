const publicPrefixes = ['/api/auth', '/healthz', '/readyz'];

export function isPublicRequest(pathname: string, method: string): boolean {
  if (method === 'OPTIONS') {
    return true;
  }
  return publicPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
