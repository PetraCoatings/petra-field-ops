/**
 * Daily field report content.
 *
 * The crew lead enters readings and material use; the server recomputes:
 * - dew point for each reading (Magnus formula, src/domain/calculators/dew-point)
 *   with the margin from the product's data sheet when the reading names a
 *   product that has one, otherwise the company margin (default 5 °F);
 * - actual spread rate for each material line: area × coats ÷ gallons, in
 *   SF/gal, compared with the product's recommended coverage when it has one.
 */
import { z } from "zod";
import { calculateDewPoint, DEW_POINT_FORMULA_VERSION, type SubstrateStatus } from "@/domain/calculators/dew-point";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const text = (max: number) => z.string().trim().max(max);

export const readingSchema = z.object({
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  unit: z.enum(["F", "C"]),
  airTemp: z.number().finite().min(-60).max(160),
  relativeHumidity: z.number().gt(0).max(100),
  substrateTemp: z.number().finite().min(-60).max(160).optional(),
  productId: uuid.optional(),
  productName: text(160).optional(),
});
export const materialSchema = z.object({
  productId: uuid.optional(),
  product: text(160).min(1),
  lot: text(80).optional(),
  gallons: z.number().gt(0).max(10_000),
  areaSqft: z.number().gt(0).max(1_000_000),
  coats: z.number().int().min(1).max(10).default(1),
});
export const dfrInputSchema = z.object({
  v: z.literal(1).default(1),
  crew: z.array(z.object({ employeeId: uuid.optional(), name: text(120).min(1) })).max(40).default([]),
  workPerformed: text(4000).default(""),
  areas: text(1000).default(""),
  sqftCompleted: z.number().min(0).max(1_000_000).optional(),
  readings: z.array(readingSchema).max(20).default([]),
  materials: z.array(materialSchema).max(30).default([]),
  notes: text(4000).default(""),
  nextSteps: text(2000).default(""),
});
export type DfrInput = z.infer<typeof dfrInputSchema>;
export type Reading = z.infer<typeof readingSchema>;
export type Material = z.infer<typeof materialSchema>;

export type ReadingResult = {
  dewPoint: number;
  margin: number;
  marginF: number;
  marginSource: "product" | "company";
  status?: SubstrateStatus;
  spread?: number;
  formulaVersion: string;
};
export type MaterialResult = { actualSpreadRate: number; targetSpreadRate?: number; variancePct?: number };
export type DfrContent = Omit<DfrInput, "readings" | "materials"> & {
  readings: (Reading & { result?: ReadingResult })[];
  materials: (Material & { result?: MaterialResult })[];
  computedAt?: string;
};

export type ProductFacts = { dewPointMarginF: number | null; coverage: number | null };
export type ComputeContext = { companyMarginF: number; products: ReadonlyMap<string, ProductFacts> };

/** Spread rate this far off the data sheet is flagged for review. */
export const SPREAD_VARIANCE_FLAG_PCT = 10;

export function readingResult(r: Reading, ctx: ComputeContext): ReadingResult {
  const productMargin = r.productId ? (ctx.products.get(r.productId)?.dewPointMarginF ?? null) : null;
  const marginF = productMargin ?? ctx.companyMarginF;
  const d = calculateDewPoint({ unit: r.unit, airTemp: r.airTemp, relativeHumidity: r.relativeHumidity, substrateTemp: r.substrateTemp, marginF });
  return {
    dewPoint: d.dewPoint,
    margin: d.margin,
    marginF,
    marginSource: productMargin !== null ? "product" : "company",
    ...(d.status ? { status: d.status, spread: d.spread } : {}),
    formulaVersion: DEW_POINT_FORMULA_VERSION,
  };
}

export function materialResult(m: Material, ctx: ComputeContext): MaterialResult {
  const actual = (m.areaSqft * (m.coats ?? 1)) / m.gallons;
  const target = m.productId ? (ctx.products.get(m.productId)?.coverage ?? null) : null;
  return {
    actualSpreadRate: Math.round(actual * 10) / 10,
    ...(target ? { targetSpreadRate: target, variancePct: Math.round(((actual - target) / target) * 1000) / 10 } : {}),
  };
}

/** Validates the crew lead's input and adds the computed results. */
export function computeReport(raw: unknown, ctx: ComputeContext, now = new Date()): { ok: true; content: DfrContent } | { ok: false; path: string } {
  const parsed = dfrInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, path: parsed.error.issues[0]?.path.join(".") ?? "" };
  const c = parsed.data;
  return {
    ok: true,
    content: {
      ...c,
      readings: c.readings.map((r) => ({ ...r, result: readingResult(r, ctx) })),
      materials: c.materials.map((m) => ({ ...m, result: materialResult(m, ctx) })),
      computedAt: now.toISOString(),
    },
  };
}

/** Readings that say not to coat, for the summary at the top of a report. */
export const readingWarnings = (c: DfrContent) => c.readings.filter((r) => r.result?.status && r.result.status !== "ok");
export const spreadFlags = (c: DfrContent) => c.materials.filter((m) => m.result?.variancePct !== undefined && Math.abs(m.result.variancePct) > SPREAD_VARIANCE_FLAG_PCT);
