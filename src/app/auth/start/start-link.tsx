"use client";
import type { EmailOtpType } from "@supabase/supabase-js";
import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/client";

const TYPES: EmailOtpType[] = ["magiclink", "invite", "recovery"];

export function StartLink() {
  const t = useTranslations("auth");
  const [state, setState] = useState<"ready" | "working" | "failed">("ready");

  const go = async () => {
    setState("working");
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type") as EmailOtpType | null;
    const next = safeNextPath(url.searchParams.get("next"), "/set-password");
    if (!tokenHash || !type || !TYPES.includes(type)) return setState("failed");
    const { error } = await createClient().auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return setState("failed");
    window.history.replaceState(null, "", url.pathname);
    window.location.replace(next);
  };

  if (state === "failed") {
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
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t("start.title")}</h1>
      <p className="text-base text-neutral-700">{t("start.body")}</p>
      <button type="button" onClick={go} disabled={state === "working"} className={`${buttonClasses("primary", "lg")} w-full`}>
        {state === "working" ? t("finishingSignIn") : t("start.continue")}
      </button>
    </div>
  );
}
