"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateDocument } from "@/lib/actions/library";

/** Rename / hide a standalone SDS. */
export function SdsRowActions({ id, name, isActive }: { id: string; name: string; isActive: boolean }) {
  const t = useTranslations("library");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [, startTransition] = useTransition();
  const run = (patch: { name?: string; isActive?: boolean }) =>
    startTransition(async () => {
      await updateDocument(id, patch);
      setEditing(false);
      router.refresh();
    });
  return editing ? (
    <div className="flex gap-2">
      <label htmlFor={`rename-${id}`} className="sr-only">
        {t("rename")}
      </label>
      <input id={`rename-${id}`} value={value} onChange={(e) => setValue(e.target.value)} maxLength={160} className="min-h-10 rounded-lg border-2 border-neutral-300 px-2" />
      <button type="button" onClick={() => run({ name: value })} className="font-semibold text-brand-700 underline">
        {t("save")}
      </button>
    </div>
  ) : (
    <div className="flex gap-3 text-sm">
      <button type="button" onClick={() => setEditing(true)} className="font-semibold text-brand-700 underline">
        {t("rename")}
      </button>
      <button type="button" onClick={() => run({ isActive: !isActive })} className="font-semibold text-brand-700 underline">
        {isActive ? t("hide") : t("show")}
      </button>
    </div>
  );
}
