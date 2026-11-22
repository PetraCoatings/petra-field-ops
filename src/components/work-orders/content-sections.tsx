"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import type { ScheduleDay, Step, WorkOrderContent } from "@/domain/work-orders/content";
import { RowInput, RowList } from "./row-list";

export type Issue = { path: string; message: string };

export type SectionKey = "summary" | "trailer" | "jobsite" | "mixRatios" | "schedule" | "safety" | "qcTests" | "notes" | "custom" | "attachments";
export const SECTION_OF_PATH: Record<string, SectionKey> = {
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

export function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) {
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

export function StepRow({ step, update, label }: { step: Step; update: (p: Partial<Step>) => void; label: string }) {
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


/**
 * The editable sections shared by the work order editor and the template
 * editor. `attachments` (drawings) is only passed by the work order editor.
 */
export function ContentSections({
  c,
  set,
  issues,
  attachments,
}: {
  c: WorkOrderContent;
  set: <K extends keyof WorkOrderContent>(key: K, value: WorkOrderContent[K]) => void;
  issues: Issue[];
  attachments?: ReactNode;
}) {
  const t = useTranslations("workOrders.editor");
  const hasIssue = (key: string) => issues.some((i) => i.path.split(".")[0] === key);
  const ring = (key: string) => (hasIssue(key) ? "ring-2 ring-red-600 rounded-2xl" : "");
  return (
    <>
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

      {attachments}

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

    </>
  );
}
