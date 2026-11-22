"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, Eye, FileText, ImageIcon, Send, Upload } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import {
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
  type ScheduleDay,
  type Step,
  type WorkOrderContent,
} from "@/domain/work-orders/content";
import { publishWorkOrder, saveWorkOrderDraft } from "@/lib/actions/work-orders";
import { createClient } from "@/lib/supabase/client";
import { RowInput, RowList } from "./row-list";

type Issue = { path: string; message: string };

type SectionKey = "summary" | "trailer" | "jobsite" | "mixRatios" | "schedule" | "safety" | "qcTests" | "notes" | "custom" | "attachments";
const SECTION_OF_PATH: Record<string, SectionKey> = {
  summary: "summary",
  trailerMaterials: "trailer",
  jobsiteMaterials: "jobsite",
  mixRatios: "mixRatios",
  schedule: "schedule",
  safety: "safety",
  qcTests: "qcTests",
  notes: "notes",
  customSections: "custom",
  attachments: "attachments",
};

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`sec-${id}`} className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <h2 id={`sec-${id}`} className="text-lg font-bold text-neutral-950">
          {title}
        </h2>
        {hint && <p className="text-sm text-neutral-600">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function StepRow({ step, update, label }: { step: Step; update: (p: Partial<Step>) => void; label: string }) {
  const t = useTranslations("workOrders.editor");
  return (
    <div className="space-y-1">
      <RowInput label={label} value={step.text} onChange={(text) => update({ text })} multiline maxLength={1000} />
      <label className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-red-800">
        <input type="checkbox" checked={step.important} onChange={(e) => update({ important: e.target.checked })} className="size-5 accent-red-700" />
        <AlertTriangle aria-hidden className="size-4" />
        {t("important")}
      </label>
    </div>
  );
}

export function WorkOrderEditor({
  projectId,
  fwoId,
  initialTitle,
  initialContent,
  hasRevisions,
  nextRevision,
}: {
  projectId: string;
  fwoId: string;
  initialTitle: string;
  initialContent: WorkOrderContent;
  hasRevisions: boolean;
  nextRevision: number;
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

      <div className={ring("summary")}>
        <Section id="summary" title={t("sections.summary")} hint={t("hints.summary")}>
          <RowList
            rows={c.summary}
            onChange={(rows) => set("summary", rows)}
            newRow={() => ({ label: "", value: "" })}
            addLabel={t("add.summary")}
            rowLabel={(i) => c.summary[i]?.label || t("row", { n: i + 1 })}
            renderRow={(r, u) => (
              <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
                <RowInput label={t("fields.label")} value={r.label} onChange={(label) => u({ label })} maxLength={80} />
                <RowInput label={t("fields.value")} value={r.value} onChange={(value) => u({ value })} maxLength={500} />
              </div>
            )}
          />
        </Section>
      </div>

      <div className={ring("trailerMaterials")}>
        <Section id="trailer" title={t("sections.trailer")} hint={t("hints.trailer")}>
          <RowList
            rows={c.trailerMaterials.map((r) => ({ item: r.item, qty: r.qty ?? "" }))}
            onChange={(rows) => set("trailerMaterials", rows)}
            newRow={() => ({ item: "", qty: "" })}
            addLabel={t("add.material")}
            rowLabel={(i) => c.trailerMaterials[i]?.item || t("row", { n: i + 1 })}
            renderRow={(r, u) => (
              <div className="grid gap-2 sm:grid-cols-[1fr_minmax(0,10rem)]">
                <RowInput label={t("fields.item")} value={r.item} onChange={(item) => u({ item })} maxLength={200} />
                <RowInput label={t("fields.qty")} value={r.qty} onChange={(qty) => u({ qty })} maxLength={80} />
              </div>
            )}
          />
        </Section>
      </div>

      <div className={ring("jobsiteMaterials")}>
        <Section id="jobsite" title={t("sections.jobsite")} hint={t("hints.jobsite")}>
          <RowList
            rows={c.jobsiteMaterials.map((r) => ({ item: r.item, note: r.note ?? "" }))}
            onChange={(rows) => set("jobsiteMaterials", rows)}
            newRow={() => ({ item: "", note: "" })}
            addLabel={t("add.material")}
            rowLabel={(i) => c.jobsiteMaterials[i]?.item || t("row", { n: i + 1 })}
            renderRow={(r, u) => (
              <div className="grid gap-2 sm:grid-cols-[1fr_minmax(0,14rem)]">
                <RowInput label={t("fields.item")} value={r.item} onChange={(item) => u({ item })} maxLength={200} />
                <RowInput label={t("fields.whoBringing")} value={r.note} onChange={(note) => u({ note })} maxLength={200} />
              </div>
            )}
          />
        </Section>
      </div>

      <div className={ring("mixRatios")}>
        <Section id="mix" title={t("sections.mixRatios")} hint={t("hints.mixRatios")}>
          <RowList
            rows={c.mixRatios}
            onChange={(rows) => set("mixRatios", rows)}
            newRow={() => ({ product: "", ratio: "" })}
            addLabel={t("add.mixRatio")}
            rowLabel={(i) => c.mixRatios[i]?.product || t("row", { n: i + 1 })}
            renderRow={(r, u) => (
              <div className="grid gap-2 sm:grid-cols-[1fr_minmax(0,14rem)]">
                <RowInput label={t("fields.product")} value={r.product} onChange={(product) => u({ product })} maxLength={200} />
                <RowInput label={t("fields.ratio")} value={r.ratio} onChange={(ratio) => u({ ratio })} placeholder="2A : 1B" maxLength={120} />
              </div>
            )}
          />
        </Section>
      </div>

      <div className={ring("schedule")}>
        <Section id="schedule" title={t("sections.schedule")} hint={t("hints.schedule")}>
          <RowList<ScheduleDay>
            rows={c.schedule}
            onChange={(rows) => set("schedule", rows)}
            newRow={() => ({ title: t("dayN", { n: c.schedule.length + 1 }), steps: [] })}
            addLabel={t("add.day")}
            rowLabel={(i) => c.schedule[i]?.title || t("dayN", { n: i + 1 })}
            renderRow={(day, u, di) => (
              <div className="space-y-3 p-1">
                <div className="grid gap-2 sm:grid-cols-3">
                  <RowInput label={t("fields.dayTitle")} value={day.title} onChange={(v) => u({ title: v })} maxLength={80} />
                  <label className="block space-y-1">
                    <span className="block text-xs font-semibold uppercase tracking-wide text-neutral-600">{t("fields.date")}</span>
                    <input
                      type="date"
                      value={day.date ?? ""}
                      onChange={(e) => u({ date: e.target.value || undefined })}
                      className="block min-h-11 w-full rounded-lg border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
                    />
                  </label>
                  <RowInput label={t("fields.startTime")} value={day.startTime ?? ""} onChange={(v) => u({ startTime: v })} placeholder="6:00 AM" maxLength={40} />
                </div>
                <RowList<Step>
                  rows={day.steps}
                  onChange={(steps) => u({ steps })}
                  newRow={() => ({ text: "", important: false })}
                  addLabel={t("add.step")}
                  rowLabel={(i) => `${day.title || t("dayN", { n: di + 1 })}, ${t("stepN", { n: i + 1 })}`}
                  renderRow={(s, us, si) => <StepRow step={s} update={us} label={t("stepN", { n: si + 1 })} />}
                />
              </div>
            )}
          />
        </Section>
      </div>

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

      <div className={ring("safety")}>
        <Section id="safety" title={t("sections.safety")} hint={t("hints.optional")}>
          <RowList<Step>
            rows={c.safety}
            onChange={(rows) => set("safety", rows)}
            newRow={() => ({ text: "", important: false })}
            addLabel={t("add.safety")}
            rowLabel={(i) => t("row", { n: i + 1 })}
            renderRow={(s, u, i) => <StepRow step={s} update={u} label={t("row", { n: i + 1 })} />}
          />
        </Section>
      </div>

      <div className={ring("qcTests")}>
        <Section id="qc" title={t("sections.qcTests")} hint={t("hints.qcTests")}>
          <RowList
            rows={c.qcTests.map((r) => ({ test: r.test, target: r.target ?? "" }))}
            onChange={(rows) => set("qcTests", rows)}
            newRow={() => ({ test: "", target: "" })}
            addLabel={t("add.qcTest")}
            rowLabel={(i) => c.qcTests[i]?.test || t("row", { n: i + 1 })}
            renderRow={(r, u) => (
              <div className="grid gap-2 sm:grid-cols-2">
                <RowInput label={t("fields.test")} value={r.test} onChange={(test) => u({ test })} maxLength={200} />
                <RowInput label={t("fields.target")} value={r.target} onChange={(target) => u({ target })} maxLength={200} />
              </div>
            )}
          />
        </Section>
      </div>

      <div className={ring("notes")}>
        <Section id="notes" title={t("sections.notes")} hint={t("hints.optional")}>
          <textarea
            aria-labelledby="sec-notes"
            value={c.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={4}
            maxLength={10_000}
            className="block w-full rounded-xl border-2 border-neutral-300 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
          />
        </Section>
      </div>

      <div className={ring("customSections")}>
        <Section id="custom" title={t("sections.custom")} hint={t("hints.custom")}>
          <RowList
            rows={c.customSections}
            onChange={(rows) => set("customSections", rows)}
            newRow={() => ({ title: "", body: "" })}
            addLabel={t("add.custom")}
            rowLabel={(i) => c.customSections[i]?.title || t("row", { n: i + 1 })}
            renderRow={(r, u) => (
              <div className="space-y-2">
                <RowInput label={t("fields.sectionTitle")} value={r.title} onChange={(v) => u({ title: v })} maxLength={120} />
                <RowInput label={t("fields.sectionBody")} value={r.body} onChange={(body) => u({ body })} multiline maxLength={10_000} />
              </div>
            )}
          />
        </Section>
      </div>

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
