/**
 * Only allow redirects to paths on this site (prevents "open redirect"
 * phishing through email links like ?next=https://evil.example).
 *
 * Browsers drop tabs and line breaks from URLs, so "/\t/evil.example" would
 * become "//evil.example" (another site): any control character or backslash
 * is refused, and the result is re-parsed to make sure it stays on this site.
 */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const u = new URL(next, "https://this.site");
    if (u.origin !== "https://this.site") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
