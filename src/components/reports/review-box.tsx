"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { CircleCheck, Pencil, Undo2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { editSubmittedDailyReport, reviewDailyReport } from "@/lib/actions/daily-reports";

/** Office: accept a submitted report, or send it back with what to correct. */
export function ReviewBox({ id }: { id: string }) {
  const t = useTranslations("reports.review");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const go = (action: "accept" | "correct") =>
    start(async () => {
      setError(null);
      const r = await reviewDailyReport({ id, action, note }).catch(() => ({ ok: false as const, error: "generic" as const }));
      if (!r.ok) setError(t(`errors.${r.error}`));
    });
  const editFirst = () =>
    start(async () => {
      setError(null);
      const r = await editSubmittedDailyReport({ id }).catch(() => ({ ok: false as const, error: "generic" as const }));
      if (!r.ok) setError(t(`errors.${r.error}`));
    });
  return (
    <section aria-label={t("title")} className="space-y-2 rounded-2xl border-2 border-brand-600 bg-brand-50 p-4">
      <p className="font-semibold">{t("title")}</p>
      <button type="button" disabled={busy} onClick={() => go("accept")} className={buttonClasses("primary", "md")}>
        <CircleCheck aria-hidden className="size-5" />
        {t("accept")}
      </button>
      <div className="space-y-1 pt-2">
        <button type="button" disabled={busy} onClick={editFirst} className={buttonClasses("secondary", "md")}>
          <Pencil aria-hidden className="size-5" />
          {t("editFirst")}
        </button>
        <p className="text-sm text-neutral-700">{t("editFirstHelp")}</p>
      </div>
      <label className="block space-y-1 pt-2">
        <span className="block text-sm font-semibold">{t("noteLabel")}</span>
        <input value={note} onChange={(e) => setNote(e.target.value)} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base" />
      </label>
      <button type="button" disabled={busy || note.trim().length < 3} onClick={() => go("correct")} className={buttonClasses("secondary", "md")}>
        <Undo2 aria-hidden className="size-5" />
        {t("sendBack")}
      </button>
      {error && <p role="alert" className="font-medium text-red-900">{error}</p>}
    </section>
  );
}
