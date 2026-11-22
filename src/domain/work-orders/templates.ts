/**
 * Work order templates: reusable chunks of work order content.
 *
 * insertTemplate() COPIES a template's content into a work order draft. The
 * result shares no objects with the template, so later edits to either side
 * never affect the other. toTemplateContent() does the reverse for "Save as
 * template", dropping things that belong to one job (dates, drawings).
 */
import { contentSchema, dropBlankRows, type WorkOrderContent } from "./content";

export type TemplateCheck =
  | { ok: true; content: WorkOrderContent }
  | { ok: false; issues: { path: string; message: string }[] };

/** Validates template content: the same rules as a work order, but never with drawings. */
export function checkTemplateContent(raw: unknown): TemplateCheck {
  const parsed = contentSchema.safeParse(dropBlankRows(raw));
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  if (parsed.data.attachments.length > 0) return { ok: false, issues: [{ path: "attachments", message: "Templates can't hold drawings" }] };
  return { ok: true, content: parsed.data };
}

const copy = <T>(v: T): T => structuredClone(v);

/** An untouched "Day 1" with no steps (what a new work order starts with). */
function isUntouchedDay(d: WorkOrderContent["schedule"][number]): boolean {
  return d.steps.length === 0 && !d.date && !d.startTime?.trim() && /^Day \d+$/.test(d.title.trim());
}

/**
 * Adds a template to a work order draft:
 *   - summary: fills a row whose label matches and whose value is still empty;
 *     otherwise adds the row (rows already filled in are never overwritten)
 *   - lists (materials, mix ratios, safety, QC tests, custom sections): appended
 *   - schedule: the template's days are appended; an untouched empty "Day 1"
 *     in the draft is replaced rather than left in front of them
 *   - notes: appended after a blank line
 *   - drawings: unchanged (templates have none)
 */
export function insertTemplate(draft: WorkOrderContent, template: WorkOrderContent): WorkOrderContent {
  const t = copy(template);
  const out = copy(draft);

  for (const row of t.summary) {
    const match = out.summary.find((r) => r.label.trim().toLowerCase() === row.label.trim().toLowerCase());
    if (match && !match.value.trim()) match.value = row.value;
    else if (!match) out.summary.push(row);
    else if (match.value.trim() !== row.value.trim() && row.value.trim()) out.summary.push(row);
  }
  out.trailerMaterials.push(...t.trailerMaterials);
  out.jobsiteMaterials.push(...t.jobsiteMaterials);
  out.mixRatios.push(...t.mixRatios);
  out.safety.push(...t.safety);
  out.qcTests.push(...t.qcTests);
  out.customSections.push(...t.customSections);
  if (t.schedule.length > 0) {
    out.schedule = [...out.schedule.filter((d) => !isUntouchedDay(d)), ...t.schedule];
  }
  if (t.notes.trim()) out.notes = out.notes.trim() ? `${out.notes.trimEnd()}\n\n${t.notes.trim()}` : t.notes.trim();
  return out;
}

/** A work order's content made reusable: no dates, no drawings. */
export function toTemplateContent(c: WorkOrderContent): WorkOrderContent {
  const t = copy(c);
  t.schedule = t.schedule.map(({ date: _date, ...day }) => day);
  t.attachments = [];
  return t;
}

/** Short description of what a template contains, e.g. for a picker: counts per section. */
export function templateSummary(c: WorkOrderContent) {
  return {
    days: c.schedule.length,
    steps: c.schedule.reduce((n, d) => n + d.steps.length, 0),
    materials: c.trailerMaterials.length + c.jobsiteMaterials.length,
    mixRatios: c.mixRatios.length,
    other: c.safety.length + c.qcTests.length + c.customSections.length + (c.notes.trim() ? 1 : 0) + c.summary.filter((r) => r.value.trim()).length,
  };
}
