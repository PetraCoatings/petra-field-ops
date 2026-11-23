"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { markEntered } from "@/lib/actions/payroll";

/** "Mark as entered in Gusto" (asks first; entering the same period again needs a reason). */
export function MarkEntered({ period, inputHash, blocked, alreadyEntered }: { period: string; inputHash: string; blocked: boolean; alreadyEntered: boolean }) {
  const t = useTranslations("payroll.mark");
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();
  return (
    <section aria-label={t("title")} className="mt-6 max-w-3xl space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-base text-neutral-700">{alreadyEntered ? t("againHelp") : t("help")}</p>
      {blocked && <p className="font-semibold text-red-900">{t("blocked")}</p>}
      {!confirm ? (
        <button type="button" disabled={blocked || busy} onClick={() => setConfirm(true)} className={buttonClasses(alreadyEntered ? "secondary" : "primary", "lg")}>
          <CircleCheck aria-hidden className="size-6" />
          {alreadyEntered ? t("again") : t("button")}
        </button>
      ) : (
        <div role="alertdialog" aria-labelledby="mark-q" className="space-y-2 rounded-xl border-2 border-brand-600 bg-brand-50 p-3">
          <p id="mark-q" className="font-semibold">{alreadyEntered ? t("confirmAgain") : t("confirm")}</p>
          {alreadyEntered && (
            <label className="block space-y-1">
              <span className="block text-sm font-semibold">{t("reason")}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 px-3 text-base" />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || (alreadyEntered && reason.trim().length < 3)}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const r = await markEntered({ period, inputHash, replaceReason: alreadyEntered ? reason : undefined }).catch(() => ({ ok: false as const, error: "generic" as const }));
                  if (!r.ok) return setError(t(`errors.${r.error}`));
                  setDone(true);
                  setConfirm(false);
                  setReason("");
                })
              }
              className={buttonClasses("primary", "md")}
            >
              {t("yes")}
            </button>
            <button type="button" onClick={() => setConfirm(false)} className={buttonClasses("ghost", "md")}>
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="font-medium text-red-900">{error}</p>}
      {done && <p role="status" className="font-medium text-green-900">{t("done")}</p>}
    </section>
  );
}
