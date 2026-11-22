"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { BookCopy, Save } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import type { WorkOrderContent } from "@/domain/work-orders/content";
import { insertTemplate, templateSummary } from "@/domain/work-orders/templates";
import { saveWorkOrderAsTemplate } from "@/lib/actions/templates";

export type TemplateOption = { id: string; name: string; description: string | null; content: WorkOrderContent };

/**
 * In the work order editor: insert a saved template (a copy is merged into the
 * draft) or save the current work order as a new template.
 */
export function TemplateTools({
  templates,
  content,
  onInsert,
}: {
  templates: TemplateOption[];
  content: WorkOrderContent;
  onInsert: (next: WorkOrderContent) => void;
}) {
  const t = useTranslations("templates.tools");
  const tt = useTranslations("templates");
  const [chosen, setChosen] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string; templateId?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = templates.find((x) => x.id === chosen);
  const s = selected ? templateSummary(selected.content) : null;

  const insert = () => {
    if (!selected) return;
    onInsert(insertTemplate(content, selected.content));
    setMessage({ tone: "success", text: t("inserted", { name: selected.name }) });
    setChosen("");
  };

  const saveAs = () =>
    startTransition(async () => {
      const r = await saveWorkOrderAsTemplate({ name, content });
      if (r.ok) {
        setMessage({ tone: "success", text: t("savedAs", { name: name.trim() }), templateId: r.id });
        setSaving(false);
        setName("");
      } else {
        setMessage({ tone: "error", text: r.error === "invalid" ? t("saveInvalid") : tt(`errors.${r.error}`) });
      }
    });

  return (
    <section aria-labelledby="tpl-tools" className="space-y-3 rounded-2xl border border-brand-100 bg-brand-50 p-4 sm:p-5">
      <h2 id="tpl-tools" className="flex items-center gap-2 text-lg font-bold text-brand-900">
        <BookCopy aria-hidden className="size-5" />
        {t("title")}
      </h2>
      {templates.length === 0 ? (
        <p className="text-base text-brand-900">
          {t("none")}{" "}
          <Link href="/manage/templates" className="font-semibold underline">
            {tt("title")}
          </Link>
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label htmlFor="tpl-choose" className="block text-sm font-semibold text-neutral-800">
                {t("insertLabel")}
              </label>
              <select
                id="tpl-choose"
                value={chosen}
                onChange={(e) => setChosen(e.target.value)}
                className="block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
              >
                <option value="">{t("choose")}</option>
                {templates.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={insert} disabled={!selected} className={buttonClasses("primary", "md")}>
              {t("insert")}
            </button>
          </div>
          {selected && s && (
            <p className="text-sm text-brand-900">
              {selected.description && <span className="font-semibold">{selected.description} · </span>}
              {tt("contains", { days: s.days, steps: s.steps, materials: s.materials, mixRatios: s.mixRatios })}
            </p>
          )}
        </div>
      )}

      {saving ? (
        <div className="flex flex-wrap items-end gap-2 border-t border-brand-100 pt-3">
          <div className="min-w-0 flex-1 space-y-1">
            <label htmlFor="tpl-save-name" className="block text-sm font-semibold text-neutral-800">
              {t("saveAsName")}
            </label>
            <input
              id="tpl-save-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              placeholder={tt("newNamePlaceholder")}
              className="block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
            />
          </div>
          <button type="button" onClick={saveAs} disabled={pending || !name.trim()} className={buttonClasses("primary", "md")}>
            {t("saveAsButton")}
          </button>
          <button type="button" onClick={() => setSaving(false)} className={buttonClasses("ghost", "md")}>
            {t("cancel")}
          </button>
          <p className="w-full text-sm text-neutral-700">{t("saveAsHint")}</p>
        </div>
      ) : (
        <button type="button" onClick={() => setSaving(true)} className={buttonClasses("secondary", "md")}>
          <Save aria-hidden className="size-5" />
          {t("saveAs")}
        </button>
      )}

      {message && (
        <p role="status" className={`text-sm font-semibold ${message.tone === "error" ? "text-red-700" : "text-green-800"}`}>
          {message.text}{" "}
          {message.templateId && (
            <Link href={`/manage/templates/${message.templateId}`} className="underline">
              {t("openTemplate")}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}
