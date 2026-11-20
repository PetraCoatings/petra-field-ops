import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for links in invitation and password-reset emails.
 * Exchanges the one-time token for a session, then continues to `next`
 * (normally /set-password). See docs/SETUP.md for the email templates.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(searchParams.get("next"), "/set-password");

  const target = request.nextUrl.clone();
  target.search = "";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const dest = new URL(next, request.nextUrl.origin);
      return NextResponse.redirect(dest);
    }
  }
  target.pathname = "/login";
  target.searchParams.set("reason", "link-invalid");
  return NextResponse.redirect(target);
}
