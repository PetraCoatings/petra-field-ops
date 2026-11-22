/**
 * Saved calculator results ("Save to job"): what each calculator sends, and
 * the server-side recomputation that produces the stored result.
 *
 * The phone sends only the INPUTS. The server validates them with these
 * schemas and recomputes the outputs with the same pure functions the phone
 * uses, so a stored result always matches its inputs and this code version.
 */
import { z } from "zod";
import { calculateArea, type AreaInput } from "./area";
import { calculateDewPoint } from "./dew-point";
import { calculateMaterial } from "./material";
import { calculateMix } from "./mix-ratio";
import { fromMils, fromSpreadRate, spreadRateFromWft } from "./spread-rate";

/** Bump when any calculator's math changes, so old saves stay traceable. */
export const CALC_ENGINE_VERSION = "calculators-2026.11.1";

export const CALCULATION_TYPES = ["square_footage", "spread_rate", "material_quantity", "mix_ratio", "dew_point"] as const;
export type CalculationType = (typeof CALCULATION_TYPES)[number];

// Generous upper limits: big enough for any real job, small enough to catch typos and abuse.
const num = z.number().finite();
const positive = (max: number) => num.positive().max(max);
const percent = num.gt(0).max(100);
const lossPercent = num.min(0).lt(100);

const operation = z.enum(["add", "subtract"]);
const areaCommon = { name: z.string().trim().max(60).optional(), operation, quantity: z.number().int().min(1).max(10_000) };
const FEET = 100_000;
const areaSchema = z.discriminatedUnion("shape", [
  z.object({ shape: z.literal("rectangle"), length: positive(FEET), width: positive(FEET), ...areaCommon }),
  z.object({ shape: z.literal("triangle"), base: positive(FEET), height: positive(FEET), ...areaCommon }),
  z.object({ shape: z.literal("circle"), diameter: positive(FEET), ...areaCommon }),
]);

export const inputSchemas = {
  square_footage: z.object({ areas: z.array(areaSchema).min(1).max(100) }),
  spread_rate: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("fromRate"), spreadRate: positive(100_000), volumeSolidsPct: percent.optional() }),
    z
      .object({
        mode: z.literal("fromMils"),
        mils: positive(10_000),
        basis: z.enum(["wft", "dft"]),
        volumeSolidsPct: percent.optional(),
        lossPct: lossPercent.optional(),
      })
      .refine((v) => v.basis === "wft" || v.volumeSolidsPct !== undefined, { message: "dft needs volume solids" }),
  ]),
  material_quantity: z.object({
    areaSqft: positive(10_000_000),
    coverage: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("rate"), spreadRate: positive(100_000) }),
      z.object({ mode: z.literal("mils"), wftMils: positive(10_000) }),
    ]),
    coats: z.number().int().min(1).max(50),
    wastePct: lossPercent,
    kitGallons: positive(10_000).optional(),
  }),
  mix_ratio: z.object({
    basis: z.enum(["volume", "weight"]),
    ratioA: positive(1_000),
    ratioB: positive(1_000),
    known: z.enum(["total", "a", "b"]),
    /** fl oz (volume) or oz (weight) */
    amount: positive(1_000_000),
  }),
  dew_point: z.object({
    unit: z.enum(["F", "C"]),
    airTemp: num.min(-100).max(200),
    relativeHumidity: percent,
    substrateTemp: num.min(-100).max(200).optional(),
    /** Approved product whose data sheet margin applies (the server looks the margin up). */
    productId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i).optional(),
  }),
} as const;

export type SavedInputs = { [K in CalculationType]: z.infer<(typeof inputSchemas)[K]> };

/** Server-side context the phone doesn't get to choose. */
export type ComputeContext = { dewPointMarginF: number };

export type SavedOutputs = {
  square_footage: { added: number; subtracted: number; net: number };
  spread_rate: { wft: number; dft?: number; spreadRate: number; practicalSpreadRate?: number };
  material_quantity: { spreadRate: number; baseGallons: number; wasteGallons: number; totalGallons: number; kits?: number; leftoverGallons?: number };
  mix_ratio: { a: number; b: number; total: number };
  dew_point: { dewPoint: number; marginF: number; margin: number; minimumSubstrate: number; spread?: number; status?: "ok" | "belowMargin" | "condensation" };
};

export type ValidatedSave<K extends CalculationType = CalculationType> = {
  type: K;
  inputs: SavedInputs[K];
  outputs: SavedOutputs[K];
};

/** Validates the inputs for `type` and recomputes the result. Returns null if anything is invalid. */
export function validateAndCompute(type: unknown, rawInputs: unknown, ctx: ComputeContext): ValidatedSave | null {
  if (!CALCULATION_TYPES.includes(type as CalculationType)) return null;
  const t = type as CalculationType;
  const parsed = inputSchemas[t].safeParse(rawInputs);
  if (!parsed.success) return null;
  try {
    return { type: t, inputs: parsed.data, outputs: compute(t, parsed.data as never, ctx) } as ValidatedSave;
  } catch {
    return null; // RangeError from a calculator: refuse rather than store a bad result
  }
}

function compute<K extends CalculationType>(type: K, inputs: SavedInputs[K], ctx: ComputeContext): SavedOutputs[K] {
  switch (type) {
    case "square_footage": {
      const i = inputs as SavedInputs["square_footage"];
      const r = calculateArea(i.areas as AreaInput[]);
      if (r.net < 0) throw new RangeError("Net area is negative.");
      return { added: r.added, subtracted: r.subtracted, net: r.net } as SavedOutputs[K];
    }
    case "spread_rate": {
      const i = inputs as SavedInputs["spread_rate"];
      if (i.mode === "fromRate") {
        const r = fromSpreadRate({ spreadRate: i.spreadRate, volumeSolidsPct: i.volumeSolidsPct });
        return { ...r, spreadRate: i.spreadRate } as SavedOutputs[K];
      }
      return fromMils(i) as SavedOutputs[K];
    }
    case "material_quantity": {
      const i = inputs as SavedInputs["material_quantity"];
      const spreadRate = i.coverage.mode === "rate" ? i.coverage.spreadRate : spreadRateFromWft(i.coverage.wftMils);
      const r = calculateMaterial({ areaSqft: i.areaSqft, spreadRate, coats: i.coats, wastePct: i.wastePct, kitGallons: i.kitGallons });
      return { spreadRate, ...r } as SavedOutputs[K];
    }
    case "mix_ratio": {
      const i = inputs as SavedInputs["mix_ratio"];
      return calculateMix(i) as SavedOutputs[K];
    }
    case "dew_point": {
      const i = inputs as SavedInputs["dew_point"];
      const r = calculateDewPoint({
        unit: i.unit,
        airTemp: i.airTemp,
        relativeHumidity: i.relativeHumidity,
        substrateTemp: i.substrateTemp,
        marginF: ctx.dewPointMarginF,
      });
      return {
        dewPoint: r.dewPoint,
        marginF: ctx.dewPointMarginF,
        margin: r.margin,
        minimumSubstrate: r.minimumSubstrate,
        spread: r.spread,
        status: r.status,
      } as SavedOutputs[K];
    }
  }
  throw new RangeError("Unknown calculation type.");
}
