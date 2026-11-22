"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { ContentSections, SECTION_OF_PATH, type Issue } from "@/components/work-orders/content-sections";
import type { WorkOrderContent } from "@/domain/work-orders/content";
import { deleteTemplate, saveTemplate, setTemplateActive } from "@/lib/actions/templates";

export function TemplateEditor({
  id,
  initialName,
  initialDescription,
  initialContent,
  isActive,
}: {
  id: string;
  initialName: string;
  initialDescription: string;
  initialContent: WorkOrderContent;
  isActive: boolean;
}) {
  const t = useTranslations("templates");
  const te = useTranslations("workOrders.editor");
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [c, setC] = useState<WorkOrderContent>(initialContent);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = <K extends keyof WorkOrderContent>(key: K, value: WorkOrderContent[K]) => {
    setC((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await saveTemplate(id, { name, description, content: c });
      if (r.ok) {
        setDirty(false);
        setIssues([]);
        setMessage({ tone: "success", text: t("saved") });
        router.refresh();
      } else {
        setIssues(r.issues ?? []);
        const sections = [...new Set((r.issues ?? []).map((i) => te(`sections.${SECTION_OF_PATH[i.path.split(".")[0]] ?? "notes"}`)))].join(", ");
        setMessage({ tone: "error", text: r.error === "invalid" ? te("errors.invalid", { sections }) : t(`errors.${r.error}`) });
      }
    });

  return (
    <div className="space-y-4 pb-28">
      <div className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2 sm:p-5">
        <div className="space-y-1">
          <label htmlFor="tpl-name" className="block text-sm font-semibold text-neutral-800">
            {t("name")}
          </label>
          <input
            id="tpl-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            maxLength={120}
            className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-lg font-semibold focus:border-brand-600 focus:outline-none"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="tpl-description" className="block text-sm font-semibold text-neutral-800">
            {t("description")}
          </label>
          <input
            id="tpl-description"
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setDirty(true);
            }}
            maxLength={500}
            placeholder={t("descriptionPlaceholder")}
            className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
          />
        </div>
      </div>

      <ContentSections c={c} set={set} issues={issues} />

      <div className="flex flex-wrap gap-2 border-t border-neutral-300 pt-4">
        <button
          type="button"
          onClick={() => startTransition(() => setTemplateActive(id, !isActive))}
          className={buttonClasses("secondary", "md")}
        >
          {isActive ? <Archive aria-hidden className="size-5" /> : <ArchiveRestore aria-hidden className="size-5" />}
          {isActive ? t("archive") : t("restore")}
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm(t("confirmDelete"))) startTransition(() => deleteTemplate(id));
          }}
          className={buttonClasses("ghost", "md", "text-red-700 hover:bg-red-50")}
        >
          <Trash2 aria-hidden className="size-5" />
          {t("delete")}
        </button>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-300 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={pending} className={buttonClasses("primary", "md")}>
            {pending ? te("saving") : t("save")}
          </button>
          <p role="status" className={`text-sm ${message?.tone === "error" ? "font-semibold text-red-700" : message ? "font-semibold text-green-800" : "text-neutral-600"}`}>
            {message ? message.text : dirty ? te("unsaved") : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
