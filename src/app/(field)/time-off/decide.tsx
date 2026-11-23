"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { useRuntimeT } from "@/components/ui/form-message";
import { decideTimeOff } from "@/lib/actions/time-off";

/** Approve or say no (with a reason) to someone's time-off request. */
export function Decide({ id, final }: { id: string; final: boolean }) {
  const t = useTranslations("timeOff");
  const rt = useRuntimeT();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const go = (approve: boolean) =>
    start(async () => {
      setError(null);
      if (!approve && note.trim().length === 0) return setError(t("errors.reason"));
      const r = await decideTimeOff({ id, approve, note }).catch(() => ({ ok: false as const, message: "common.genericError" }));
      if (!r.ok) setError(rt(r.message) ?? t("errors.forbidden"));
    });
  return (
    <div className="space-y-2">
      <input aria-label={t("noteLabel")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("noteLabel")} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 px-3 text-base" />
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => go(true)} className={buttonClasses("primary", "md")}>
          <Check aria-hidden className="size-5" />
          {final ? t("approveFinal") : t("approve")}
        </button>
        <button type="button" disabled={busy} onClick={() => go(false)} className={buttonClasses("secondary", "md")}>
          <X aria-hidden className="size-5" />
          {t("reject")}
        </button>
      </div>
      {error && <p role="alert" className="font-medium text-red-900">{error}</p>}
    </div>
  );
}
