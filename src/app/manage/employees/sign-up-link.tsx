"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Copy, Link2, Share2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import type { SignUpLinkResult } from "./actions";

/** "Get a sign-up link to text": for when the invitation email doesn't arrive. */
export function SignUpLink({ action, name }: { action: () => Promise<SignUpLinkResult>; name: string }) {
  const t = useTranslations("employees.signUpLink");
  const [busy, start] = useTransition();
  const [result, setResult] = useState<SignUpLinkResult | null>(null);
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          start(async () => {
            setCopied(false);
            setResult(await action());
          })
        }
        className={buttonClasses("secondary", "md")}
      >
        <Link2 aria-hidden className="size-5" />
        {busy ? t("making") : t("make")}
      </button>
      {result?.ok === false && <p role="alert" className="text-base text-red-900">{t("failed", { reason: result.reason })}</p>}
      {result?.ok && (
        <div className="space-y-2 rounded-xl border-2 border-brand-600 bg-brand-50 p-3">
          <label className="block space-y-1">
            <span className="block text-sm font-semibold">{t("label", { name })}</span>
            <input readOnly value={result.link} onFocus={(e) => e.target.select()} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-sm" />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(result.link);
                setCopied(true);
              }}
              className={buttonClasses("primary", "md")}
            >
              <Copy aria-hidden className="size-5" />
              {copied ? t("copied") : t("copy")}
            </button>
            {canShare && (
              <button type="button" onClick={() => navigator.share({ text: result.link }).catch(() => undefined)} className={buttonClasses("secondary", "md")}>
                <Share2 aria-hidden className="size-5" />
                {t("share")}
              </button>
            )}
          </div>
          <p className="text-sm text-neutral-700">{t("note")}</p>
        </div>
      )}
    </div>
  );
}
