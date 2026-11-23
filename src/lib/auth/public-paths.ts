/** Paths reachable without signing in. Everything else requires a session. */
const PUBLIC_PREFIXES = ["/login", "/forgot-password", "/auth/", "/calendar-feed/"] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}
