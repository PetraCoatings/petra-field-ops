"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { buttonClasses } from "@/components/ui/button-styles";
import { ISSUE_TYPES } from "@/domain/reports/field";
import { reportIssue } from "@/lib/actions/issues";
import { uploadPhoto } from "@/components/photos/upload";

/** Report a jobsite issue, with optional photos. The PM is notified. */
export function ReportIssueForm({ projectId }: { projectId: string }) {
  const t = useTranslations("issues");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof ISSUE_TYPES)[number]>("concrete");
  const [description, setDescription] = useState("");
  const [urgent, setUrgent] = useState(false);
  const files = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, start] = useTransition();
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClasses("secondary", "md")}>
        {t("report")}
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setMessage(null);
          const r = await reportIssue({ projectId, type, description, urgent }).catch(() => ({ ok: false as const, error: "generic" as const }));
          if (!r.ok) return setMessage({ kind: "error", text: t(`errors.${r.error}`) });
          let failed = 0;
          for (const f of [...(files.current?.files ?? [])].slice(0, 10)) {
            const ok = await uploadPhoto(f, { projectId, stage: "issue", issueId: r.id }).catch(() => false);
            if (!ok) failed++;
          }
          setMessage({ kind: failed ? "error" : "ok", text: failed ? t("photosFailed", { failed }) : t("sent") });
          setDescription("");
          setUrgent(false);
          if (files.current) files.current.value = "";
          setOpen(false);
          router.refresh();
        });
      }}
      className="space-y-3 rounded-xl border-2 border-brand-600 bg-brand-50 p-3"
    >
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">{t("type")}</span>
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base">
          {ISSUE_TYPES.map((x) => (
            <option key={x} value={x}>
              {t(`types.${x}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">{t("description")}</span>
        <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionExample")} className="block w-full rounded-lg border-2 border-neutral-300 bg-white p-3 text-base" />
      </label>
      <label className="flex min-h-11 items-center gap-3">
        <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="size-6 accent-red-700" />
        <span className="font-semibold">{t("urgent")}</span>
      </label>
      <label className="block space-y-1">
        <span className="block text-sm font-semibold">{t("photos")}</span>
        <input ref={files} type="file" accept="image/*" multiple className="block text-base" />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || description.trim().length < 3} className={buttonClasses("primary", "md")}>
          {busy ? t("sending") : t("send")}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClasses("ghost", "md")}>
          {t("cancel")}
        </button>
      </div>
      {message && <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-red-900" : "text-green-900"}>{message.text}</p>}
    </form>
  );
}
