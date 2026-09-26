export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).toLowerCase() : '';
}

export function isEmailDomainAllowed(email: string, allowedDomains: readonly string[]): boolean {
  const domain = emailDomain(email);
  if (!domain) {
    return false;
  }
  for (const allowed of allowedDomains) {
    if (allowed.toLowerCase() === domain) {
      return true;
    }
  }
  return false;
}
