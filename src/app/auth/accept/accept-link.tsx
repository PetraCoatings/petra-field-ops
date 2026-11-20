"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { parseAuthHash } from "@/lib/auth/email-link";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/client";

/**
 * Landing page for invitation links sent with Supabase's default email template.
 * The tokens arrive in the URL fragment (#…), which only the browser can read,
 * so this runs client-side, saves the session as a cookie, and continues.
 */
export function AcceptLink() {
  const t = useTranslations("auth");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    /** Returns false if the link can't be used. */
    async function run(): Promise<boolean> {
      const url = new URL(window.location.href);
      const next = safeNextPath(url.searchParams.get("next"), "/set-password");

      // Code or token-hash links are handled by the server route.
      if (url.searchParams.has("code") || url.searchParams.has("token_hash")) {
        window.location.replace(`/auth/confirm${url.search}`);
        return true;
      }

      const result = parseAuthHash(url.hash);
      // Remove the tokens from the address bar and browser history right away.
      window.history.replaceState(null, "", url.pathname + url.search);
      if (result.kind !== "session") return false;

      const { error } = await createClient().auth.setSession({
        access_token: result.accessToken,
        refresh_token: result.refreshToken,
      });
      if (error) return false;
      window.location.replace(next);
      return true;
    }
    run().then((ok) => {
      if (!ok) setFailed(true);
    });
  }, []);

  if (failed) {
    return (
      <div className="space-y-4">
        <Alert tone="error">{t("linkInvalid")}</Alert>
        <Link href="/login" className="inline-block min-h-11 py-2 font-semibold text-brand-700 underline">
          {t("backToSignIn")}
        </Link>
      </div>
    );
  }
  return (
    <p role="status" className="text-lg">
      {t("finishingSignIn")}
    </p>
  );
}
