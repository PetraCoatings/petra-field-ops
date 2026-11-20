/**
 * Reading the result of a Supabase email link.
 *
 * Supabase's DEFAULT email templates (used until Petra connects its own email
 * sender, which is required to customize templates) send people back with:
 *   - invitations:      tokens in the URL fragment  (#access_token=…&refresh_token=…)
 *   - password resets:  a one-time code in the query (?code=…)
 *   - failures:         an error in the fragment     (#error=…&error_code=otp_expired)
 * Our custom templates instead use ?token_hash=…&type=… . The app accepts all of these.
 */
export type HashResult =
  | { kind: "session"; accessToken: string; refreshToken: string }
  | { kind: "error"; code: string }
  | { kind: "none" };

export function parseAuthHash(hash: string): HashResult {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const error = params.get("error_code") ?? params.get("error");
  if (error) return { kind: "error", code: error };
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "session", accessToken, refreshToken };
  return { kind: "none" };
}
