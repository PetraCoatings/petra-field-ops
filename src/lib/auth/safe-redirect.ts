/**
 * Only allow redirects to paths on this site (prevents "open redirect"
 * phishing through email links like ?next=https://evil.example).
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
