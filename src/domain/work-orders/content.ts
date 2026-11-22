/**
 * Field work order content: the sections the office fills in, modeled on
 * Petra's existing work order (job summary, materials in the trailer, items at
 * the jobsite, mix ratios, a day-by-day schedule and drawings), plus optional
 * safety, QC tests, notes and custom sections. Empty sections are hidden.
 *
 * The job name, address and site contacts are NOT stored here: they come from
 * the project and are frozen into each revision when it's published.
 *
 * Stored as JSON (fwo_drafts.content, fwo_revisions.content). `v` is the
 * format version, so older revisions keep rendering if the format grows.
 */
import { z } from "zod";

export const CONTENT_VERSION = 1;

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);

export const ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export const stepSchema = z.object({ text: required(1000), important: z.boolean().default(false) });

export const daySchema = z.object({
  /** "Day 1", "Wednesday", "Day 2"… */
  title: required(80),
  /** YYYY-MM-DD, optional */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** "6:00 AM" or free text like "6am" */
  startTime: text(40).optional(),
  steps: z.array(stepSchema).max(60).default([]),
});

export const attachmentSchema = z.object({
  /** Storage path inside the fwo-files bucket: <projectId>/<fwoId>/<file> */
  path: required(400),
  name: required(200),
  contentType: z.enum(ATTACHMENT_TYPES),
  size: z.number().int().positive().max(MAX_ATTACHMENT_BYTES),
  caption: text(200).optional(),
});

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/**
 * A product from the library, with the EXACT data sheet versions current when
 * it was added. A newer TDS/SDS uploaded later never changes what this work
 * order points to (the office can choose to update it in the draft).
 */
export const productRefSchema = z.object({
  productId: uuid,
  name: required(160),
  manufacturer: text(120).optional(),
  tdsVersionId: uuid.optional(),
  sdsVersionId: uuid.optional(),
});

export const contentSchema = z.object({
  v: z.literal(CONTENT_VERSION).default(CONTENT_VERSION),
  /** Label/value rows: System install, Available power, Prep machine… */
  summary: z.array(z.object({ label: required(80), value: text(500) })).max(30).default([]),
  /** "Materials to bring in trailer"; also the crew lead's loading checklist. */
  trailerMaterials: z.array(z.object({ item: required(200), qty: text(80).optional() })).max(200).default([]),
  /** "Shipped to / left at jobsite", with who's bringing it. */
  jobsiteMaterials: z.array(z.object({ item: required(200), note: text(200).optional() })).max(200).default([]),
  /** Product and ratio as written on the data sheet, e.g. "2.18A : 1B : .15C : .3Pig". */
  mixRatios: z.array(z.object({ product: required(200), ratio: required(120) })).max(50).default([]),
  schedule: z.array(daySchema).max(60).default([]),
  safety: z.array(stepSchema).max(60).default([]),
  qcTests: z.array(z.object({ test: required(200), target: text(200).optional() })).max(50).default([]),
  notes: text(10_000).default(""),
  customSections: z.array(z.object({ title: required(120), body: text(10_000) })).max(20).default([]),
  attachments: z.array(attachmentSchema).max(50).default([]),
  /** Products used on the job, with pinned data sheet versions. */
  products: z.array(productRefSchema).max(50).default([]),
});

export type WorkOrderContent = z.infer<typeof contentSchema>;
export type ScheduleDay = z.infer<typeof daySchema>;
export type Step = z.infer<typeof stepSchema>;
export type Attachment = z.infer<typeof attachmentSchema>;
export type ProductRef = z.infer<typeof productRefSchema>;

/** A new work order starts with the summary rows Petra uses and a Day 1. */
export function newWorkOrderContent(): WorkOrderContent {
  return {
    v: CONTENT_VERSION,
    summary: [
      { label: "System install", value: "" },
      { label: "Available power", value: "" },
      { label: "Prep machine", value: "" },
    ],
    trailerMaterials: [],
    jobsiteMaterials: [],
    mixRatios: [],
    schedule: [{ title: "Day 1", steps: [] }],
    safety: [],
    qcTests: [],
    notes: "",
    customSections: [],
    attachments: [],
    products: [],
  };
}

/**
 * Cleans what the editor sends before validating: drops rows that were left
 * completely blank (an empty materials row, a step with no text) so a
 * half-filled form doesn't fail. Rows with SOME text are kept and validated.
 */
export function dropBlankRows(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const c = { ...(raw as Record<string, unknown>) };
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
  const keep = (key: string, isBlank: (row: Record<string, unknown>) => boolean) => {
    if (Array.isArray(c[key])) c[key] = (c[key] as Record<string, unknown>[]).filter((r) => !(typeof r === "object" && r !== null && isBlank(r)));
  };
  keep("summary", (r) => blank(r.label) && blank(r.value)); // a label with no value stays in the draft but is hidden from crews
  keep("trailerMaterials", (r) => blank(r.item) && blank(r.qty));
  keep("jobsiteMaterials", (r) => blank(r.item) && blank(r.note));
  keep("mixRatios", (r) => blank(r.product) && blank(r.ratio));
  keep("safety", (r) => blank(r.text));
  keep("qcTests", (r) => blank(r.test) && blank(r.target));
  keep("customSections", (r) => blank(r.title) && blank(r.body));
  if (Array.isArray(c.schedule)) {
    c.schedule = (c.schedule as Record<string, unknown>[]).map((d) =>
      typeof d === "object" && d !== null && Array.isArray(d.steps)
        ? { ...d, steps: (d.steps as Record<string, unknown>[]).filter((s) => !(typeof s === "object" && s !== null && blank(s.text))) }
        : d,
    );
    c.schedule = (c.schedule as Record<string, unknown>[]).filter(
      (d) => !(typeof d === "object" && d !== null && Array.isArray(d.steps) && d.steps.length === 0 && blank(d.date) && blank(d.startTime) && /^Day \d+$/.test(String(d.title ?? "").trim())),
    );
  }
  // Optional strings: "" → undefined
  for (const key of ["trailerMaterials", "jobsiteMaterials", "qcTests", "attachments", "products"] as const) {
    if (Array.isArray(c[key]))
      c[key] = (c[key] as Record<string, unknown>[]).map((r) =>
        Object.fromEntries(Object.entries(r).filter(([, v]) => !(typeof v === "string" && v.trim() === ""))),
      );
  }
  if (Array.isArray(c.schedule))
    c.schedule = (c.schedule as Record<string, unknown>[]).map((d) =>
      Object.fromEntries(Object.entries(d).filter(([, v]) => !(typeof v === "string" && v.trim() === ""))),
    );
  return c;
}

export type ContentCheck =
  | { ok: true; content: WorkOrderContent }
  | { ok: false; issues: { path: string; message: string }[] };

/**
 * Validates content from the editor for a given work order. Attachments must
 * live in this work order's folder, so a draft can't point at another job's files.
 */
export function checkContent(raw: unknown, where: { projectId: string; fwoId: string }): ContentCheck {
  const parsed = contentSchema.safeParse(dropBlankRows(raw));
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  }
  const prefix = `${where.projectId}/${where.fwoId}/`;
  const bad = parsed.data.attachments.findIndex((a) => !a.path.startsWith(prefix) || a.path.includes(".."));
  if (bad >= 0) return { ok: false, issues: [{ path: `attachments.${bad}.path`, message: "File is not in this work order's folder" }] };
  return { ok: true, content: parsed.data };
}

/** True when nothing a crew would see has been filled in. */
export function isEmptyContent(c: WorkOrderContent): boolean {
  return (
    c.summary.every((r) => r.value.trim() === "") &&
    c.trailerMaterials.length === 0 &&
    c.jobsiteMaterials.length === 0 &&
    c.mixRatios.length === 0 &&
    c.schedule.every((d) => d.steps.length === 0) &&
    c.safety.length === 0 &&
    c.qcTests.length === 0 &&
    c.notes.trim() === "" &&
    c.customSections.length === 0 &&
    c.attachments.length === 0 &&
    c.products.length === 0
  );
}

/** Reads stored content leniently (older or partial data never breaks the page). */
export function readContent(raw: unknown): WorkOrderContent {
  const parsed = contentSchema.safeParse(raw);
  return parsed.success ? parsed.data : newWorkOrderContent();
}
