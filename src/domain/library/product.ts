/**
 * Product records: validation of the office's product form. Every spec field
 * is optional; a blank field is stored as "not specified" (null), never 0.
 */
import { z } from "zod";

export const PRODUCT_CATEGORIES = [
  "primer",
  "basecoat",
  "topcoat",
  "mortar",
  "self_leveler",
  "sealer",
  "grout",
  "cleaner",
  "aggregate",
  "additive",
  "other",
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** Spec fields in the order the form shows them, with their limits. */
export const SPEC_FIELDS = {
  mix_ratio_a: { min: 0, exclusiveMin: true, max: 1000 },
  mix_ratio_b: { min: 0, exclusiveMin: true, max: 1000 },
  kit_size_gal: { min: 0, exclusiveMin: true, max: 1000 },
  recommended_coverage_sqft_per_gal: { min: 0, exclusiveMin: true, max: 100_000 },
  volume_solids_pct: { min: 0, exclusiveMin: true, max: 100 },
  recommended_wft_mils: { min: 0, exclusiveMin: true, max: 10_000 },
  recommended_dft_mils: { min: 0, exclusiveMin: true, max: 10_000 },
  min_application_temp_f: { min: -40, exclusiveMin: false, max: 200 },
  max_application_temp_f: { min: -40, exclusiveMin: false, max: 200 },
  max_rh_pct: { min: 0, exclusiveMin: true, max: 100 },
  min_substrate_above_dew_point_f: { min: 0, exclusiveMin: false, max: 50 },
  pot_life_minutes: { min: 0, exclusiveMin: true, max: 10_000, integer: true },
} as const;
export type SpecField = keyof typeof SPEC_FIELDS;

/** "12.5", "1,200", "" → number | null; junk → NaN. */
export function parseSpecNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (s === "") return null;
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : Number.NaN;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

export type ProductValues = {
  name: string;
  category: ProductCategory | null;
  product_code: string | null;
  description: string | null;
  mix_ratio_text: string | null;
  ratio_basis: "volume" | "weight" | null;
  cure_notes: string | null;
} & { [K in SpecField]: number | null };

export type ProductCheck = { ok: true; values: ProductValues } | { ok: false; errors: Record<string, string> };

/** Validates the product form. Error values are translation keys. */
export function checkProduct(input: Record<string, unknown>): ProductCheck {
  const errors: Record<string, string> = {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.name = "validation.required";
  else if (name.length > 160) errors.name = "validation.tooLong";

  const text = z
    .object({
      product_code: optionalText(80),
      description: optionalText(2000),
      mix_ratio_text: optionalText(120),
      cure_notes: optionalText(2000),
    })
    .safeParse({
      product_code: input.product_code ?? "",
      description: input.description ?? "",
      mix_ratio_text: input.mix_ratio_text ?? "",
      cure_notes: input.cure_notes ?? "",
    });
  if (!text.success) for (const i of text.error.issues) errors[String(i.path[0])] = "validation.tooLong";

  const category = typeof input.category === "string" && input.category ? input.category : null;
  if (category && !(PRODUCT_CATEGORIES as readonly string[]).includes(category)) errors.category = "validation.required";
  const basis = typeof input.ratio_basis === "string" && input.ratio_basis ? input.ratio_basis : null;
  if (basis && basis !== "volume" && basis !== "weight") errors.ratio_basis = "validation.required";

  const specs = {} as { [K in SpecField]: number | null };
  for (const [key, rule] of Object.entries(SPEC_FIELDS) as [SpecField, (typeof SPEC_FIELDS)[SpecField]][]) {
    const n = parseSpecNumber(input[key]);
    if (n === null) {
      specs[key] = null;
      continue;
    }
    const tooLow = rule.exclusiveMin ? n <= rule.min : n < rule.min;
    if (Number.isNaN(n) || tooLow || n > rule.max || ("integer" in rule && !Number.isInteger(n))) {
      errors[key] = "library.errors.outOfRange";
    } else specs[key] = n;
  }
  if ((specs.mix_ratio_a === null) !== (specs.mix_ratio_b === null) && !errors.mix_ratio_a && !errors.mix_ratio_b) {
    errors.mix_ratio_b = "library.errors.bothParts";
  }
  if (specs.min_application_temp_f !== null && specs.max_application_temp_f !== null && specs.min_application_temp_f > specs.max_application_temp_f) {
    errors.max_application_temp_f = "library.errors.minAboveMax";
  }

  if (Object.keys(errors).length > 0 || !text.success) return { ok: false, errors };
  return {
    ok: true,
    values: {
      name,
      category: category as ProductCategory | null,
      product_code: text.data.product_code ?? null,
      description: text.data.description ?? null,
      mix_ratio_text: text.data.mix_ratio_text ?? null,
      ratio_basis: basis as "volume" | "weight" | null,
      cure_notes: text.data.cure_notes ?? null,
      ...specs,
    },
  };
}

/** "2A : 1B" from the two parts (trailing zeros dropped), or the free-text ratio. */
export function mixRatioLabel(p: { mix_ratio_a: number | string | null; mix_ratio_b: number | string | null; mix_ratio_text?: string | null }): string | null {
  if (p.mix_ratio_text) return p.mix_ratio_text;
  if (p.mix_ratio_a === null || p.mix_ratio_b === null) return null;
  const n = (v: number | string) => String(Number(v));
  return `${n(p.mix_ratio_a)}A : ${n(p.mix_ratio_b)}B`;
}

/** Storage path for an uploaded data sheet version: <documentId>/<random>-<safe name>. */
export function isDocumentPath(path: string, documentId: string): boolean {
  return path.startsWith(`${documentId}/`) && !path.includes("..") && path.length <= 400;
}
