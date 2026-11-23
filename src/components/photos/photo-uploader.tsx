"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Camera } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { PHOTO_STAGES, type PhotoStage } from "@/domain/reports/field";
import { uploadPhoto } from "./upload";

/** "Add photos": choose the stage, then take photos or pick them from the phone. */
export function PhotoUploader({ projectId, owner }: { projectId: string; owner: string }) {
  const t = useTranslations("photos");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<PhotoStage>("before");
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number; queued: number } | null>(null);
  const busy = progress !== null && progress.done + progress.failed + progress.queued < progress.total;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, 20);
    setProgress({ done: 0, total: list.length, failed: 0, queued: 0 });
    let uploaded = 0;
    for (const f of list) {
      const r = await uploadPhoto(f, { projectId, owner, stage }).catch(() => "failed" as const);
      if (r === "uploaded") uploaded++;
      setProgress((p) => (p ? { ...p, done: p.done + (r === "uploaded" ? 1 : 0), failed: p.failed + (r === "failed" ? 1 : 0), queued: p.queued + (r === "queued" ? 1 : 0) } : p));
    }
    if (input.current) input.current.value = "";
    // Only refresh when something reached the server (with no signal a refresh reloads the page).
    if (uploaded > 0) router.refresh();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1">
          <span className="block text-sm font-semibold">{t("stage")}</span>
          <select value={stage} onChange={(e) => setStage(e.target.value as PhotoStage)} className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base">
            {PHOTO_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`stages.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={buttonClasses("primary", "md")}>
          <Camera aria-hidden className="size-5" />
          {t("add")}
        </button>
        <input ref={input} type="file" accept="image/*" multiple hidden aria-label={t("add")} data-testid="photo-input" onChange={(e) => onFiles(e.target.files)} />
      </div>
      {progress && (
        <p role="status" className={`text-sm font-medium ${progress.failed ? "text-red-900" : "text-neutral-800"}`}>
          {busy
            ? t("uploading", { done: progress.done + progress.queued, total: progress.total })
            : progress.failed
              ? t("someFailed", { failed: progress.failed })
              : progress.queued
                ? t("savedOnPhone", { count: progress.queued })
                : t("uploaded", { count: progress.done })}
        </p>
      )}
    </div>
  );
}
