import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in invitation and password-reset emails.
 * Exchanges the one-time token for a session, then continues to `next`
 * (normally /set-password). Accepts both link styles:
 *   - ?token_hash=…&type=…  (Petra's custom templates, docs/SETUP.md)
 *   - ?code=…               (Supabase's default password-reset template)
 * Default invitation links carry tokens in the URL fragment instead and are
 * handled by /auth/accept.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const code = searchParams.get("code");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/set-password");

  const target = request.nextUrl.clone();
  target.search = "";

  if ((tokenHash && type) || code) {
    const supabase = await createClient();
    const { error } =
      tokenHash && type
        ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
        : await supabase.auth.exchangeCodeForSession(code!);
    if (!error) {
      const dest = new URL(next, request.nextUrl.origin);
      return NextResponse.redirect(dest);
    }
  }
  target.pathname = "/login";
  target.searchParams.set("reason", "link-invalid");
  return NextResponse.redirect(target);
}
