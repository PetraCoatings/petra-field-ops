"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Eye, FileText, ImageIcon, Send, Upload } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
  type WorkOrderContent,
} from "@/domain/work-orders/content";
import { publishWorkOrder, saveWorkOrderDraft } from "@/lib/actions/work-orders";
import { createClient } from "@/lib/supabase/client";
import { ContentSections, SECTION_OF_PATH, Section, type Issue } from "@/components/work-orders/content-sections";
import { RowInput, RowList } from "@/components/work-orders/row-list";
import { TemplateTools, type TemplateOption } from "@/components/work-orders/template-tools";
import type { PickerProduct } from "@/lib/library/picker-types";

export function WorkOrderEditor({
  projectId,
  fwoId,
  initialTitle,
  initialContent,
  hasRevisions,
  nextRevision,
  templates,
  products,
}: {
  projectId: string;
  fwoId: string;
  initialTitle: string;
  initialContent: WorkOrderContent;
  hasRevisions: boolean;
  nextRevision: number;
  templates: TemplateOption[];
  products: PickerProduct[];
}) {
  const t = useTranslations("workOrders.editor");
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [c, setC] = useState<WorkOrderContent>(initialContent);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [changeSummary, setChangeSummary] = useState("");
  const [uploading, setUploading] = useState(0);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  const set = <K extends keyof WorkOrderContent>(key: K, value: WorkOrderContent[K]) => {
    setC((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const issueText = (list: Issue[]) =>
    [...new Set(list.map((i) => t(`sections.${SECTION_OF_PATH[i.path.split(".")[0]] ?? "notes"}`)))].join(", ");

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await saveWorkOrderDraft(fwoId, { title, content: c });
      if (r.ok) {
        setDirty(false);
        setIssues([]);
        setSavedAt(new Date(r.savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
        router.refresh();
      } else {
        setIssues(r.issues ?? []);
        setMessage({ tone: "error", text: r.error === "invalid" ? t("errors.invalid", { sections: issueText(r.issues ?? []) }) : t(`errors.${r.error}`) });
      }
    });

  const publish = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await publishWorkOrder(fwoId, { title, content: c, changeSummary });
      if (r.ok) {
        setDirty(false);
        setIssues([]);
        setChangeSummary("");
        setMessage({ tone: "success", text: t("published", { revision: r.revision }) });
        router.refresh();
      } else {
        setIssues(r.issues ?? []);
        setMessage({ tone: "error", text: r.error === "invalid" ? t("errors.invalid", { sections: issueText(r.issues ?? []) }) : t(`errors.${r.error}`) });
      }
    });

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setMessage(null);
    const supabase = createClient();
    const added: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
        setMessage({ tone: "error", text: t("errors.fileType", { name: file.name }) });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setMessage({ tone: "error", text: t("errors.fileSize", { name: file.name }) });
        continue;
      }
      setUploading((n) => n + 1);
      const safe = file.name.replace(/[^\w.\- ]+/g, "_").slice(-80);
      const path = `${projectId}/${fwoId}/${crypto.randomUUID()}-${safe}`;
      const { error } = await supabase.storage.from("fwo-files").upload(path, file, { contentType: file.type, upsert: false });
      setUploading((n) => n - 1);
      if (error) {
        setMessage({ tone: "error", text: t("errors.upload", { name: file.name }) });
        continue;
      }
      added.push({ path, name: file.name.slice(0, 200), contentType: file.type as Attachment["contentType"], size: file.size });
    }
    if (added.length) set("attachments", [...c.attachments, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const hasIssue = (key: string) => issues.some((i) => i.path.split(".")[0] === key);
  const ring = (key: string) => (hasIssue(key) ? "ring-2 ring-red-600 rounded-2xl" : "");

  return (
    <div className="space-y-4 pb-28">
      <div className="space-y-1">
        <label htmlFor="wo-title" className="block text-sm font-semibold text-neutral-800">
          {t("title")}
        </label>
        <input
          id="wo-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          maxLength={200}
          className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-lg font-semibold focus:border-brand-600 focus:outline-none"
        />
        <p className="text-sm text-neutral-600">{t("headerHint")}</p>
      </div>

      <TemplateTools
        templates={templates}
        content={c}
        onInsert={(next) => {
          setC(next);
          setDirty(true);
        }}
      />

      <ContentSections
        c={c}
        set={set}
        issues={issues}
        products={products}
        pinVersions
        attachments={
          <div className={ring("attachments")}>
        <Section id="attachments" title={t("sections.attachments")} hint={t("hints.attachments")}>
          {c.attachments.length > 0 && (
            <RowList<Attachment>
              rows={c.attachments}
              onChange={(rows) => set("attachments", rows)}
              newRow={() => c.attachments[0]}
              canAdd={false}
              addLabel=""
              rowLabel={(i) => c.attachments[i]?.name ?? ""}
              renderRow={(a, u) => (
                <div className="flex items-start gap-2">
                  {a.contentType === "application/pdf" ? (
                    <FileText aria-hidden className="mt-6 size-6 shrink-0 text-brand-700" />
                  ) : (
                    <ImageIcon aria-hidden className="mt-6 size-6 shrink-0 text-brand-700" />
                  )}
                  <RowInput className="flex-1" label={a.name} value={a.caption ?? ""} onChange={(caption) => u({ caption })} placeholder={t("fields.caption")} maxLength={200} />
                </div>
              )}
            />
          )}
          <input
            ref={fileInput}
            id="wo-files"
            type="file"
            multiple
            accept={ATTACHMENT_TYPES.join(",")}
            onChange={(e) => void upload(e.target.files)}
            className="sr-only"
          />
          <label htmlFor="wo-files" className={buttonClasses("secondary", "md", "cursor-pointer")}>
            <Upload aria-hidden className="size-5" />
            {uploading > 0 ? t("uploading") : t("add.file")}
          </label>
          <p className="text-sm text-neutral-600">{t("hints.files")}</p>
        </Section>
      </div>

        }
      />

      <section aria-labelledby="sec-publish" className="space-y-3 rounded-2xl border-2 border-brand-700 bg-brand-50 p-4 sm:p-5">
        <h2 id="sec-publish" className="text-lg font-bold text-brand-900">
          {t("publishTitle", { revision: nextRevision })}
        </h2>
        <p className="text-base text-brand-900">{hasRevisions ? t("publishHintRevision") : t("publishHintFirst")}</p>
        {hasRevisions && (
          <div className="space-y-1">
            <label htmlFor="wo-change-summary" className="block text-sm font-semibold text-neutral-800">
              {t("changeSummary")}
            </label>
            <textarea
              id="wo-change-summary"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={t("changeSummaryPlaceholder")}
              className="block w-full rounded-xl border-2 border-neutral-300 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
            />
          </div>
        )}
        <button type="button" onClick={publish} disabled={pending || uploading > 0} className={buttonClasses("primary", "lg")}>
          <Send aria-hidden className="size-5" />
          {t("publishButton", { revision: nextRevision })}
        </button>
      </section>

      {/* Sticky save bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-300 bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={pending || uploading > 0} className={buttonClasses("primary", "md")}>
            {pending ? t("saving") : t("saveDraft")}
          </button>
          <Link href={`/manage/projects/${projectId}/work-orders/${fwoId}/preview`} className={buttonClasses("secondary", "md")}>
            <Eye aria-hidden className="size-5" />
            {t("preview")}
          </Link>
          <p role="status" className={`text-sm ${message?.tone === "error" ? "font-semibold text-red-700" : message ? "font-semibold text-green-800" : "text-neutral-600"}`}>
            {message ? message.text : dirty ? t("unsaved") : savedAt ? t("savedAt", { time: savedAt }) : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
