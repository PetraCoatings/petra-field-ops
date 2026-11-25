"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { LockOpen } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { reopenDailyReport } from "@/lib/actions/daily-reports";

/** Office: reopen an accepted report for changes. A reason is required and kept. */
export function ReopenBox({ id }: { id: string }) {
  const t = useTranslations("reports.reopen");
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "md")}>
        <LockOpen aria-hidden className="size-5" />
        {t("button")}
      </button>
    );
  }
  const go = () =>
    start(async () => {
      setError(null);
      const r = await reopenDailyReport({ id, reason }).catch(() => ({ ok: false as const, error: "generic" as const }));
      if (!r.ok) setError(t(`errors.${r.error}`));
    });
  return (
    <section aria-label={t("title")} className="space-y-2 rounded-2xl border-2 border-amber-600 bg-amber-50 p-4">
      <p className="font-semibold">{t("title")}</p>
      <p className="text-sm text-neutral-800">{t("help")}</p>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">{t("reasonLabel")}</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy || reason.trim().length < 3} onClick={go} className={buttonClasses("primary", "md")}>
          <LockOpen aria-hidden className="size-5" />
          {t("confirm")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClasses("ghost", "md")}>
          {t("cancel")}
        </button>
      </div>
      {error && (
        <p role="alert" className="font-medium text-red-900">
          {error}
        </p>
      )}
    </section>
  );
}
