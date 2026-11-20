/**
 * Mix ratio: how much Part A and Part B for a batch.
 *
 * The ratio comes from the data sheet and is either by VOLUME or by WEIGHT.
 * Never mix the two: a 2:1 by volume product is not 2:1 by weight. This
 * calculator keeps the basis the crew picks and works in:
 *
 *   volume: gallons + fluid ounces (1 US gal = 128 fl oz)
 *   weight: pounds + ounces        (1 lb = 16 oz)
 *
 * Amounts are handled in the small unit (fl oz or oz).
 *
 * Rounding (decision "consistent rounding"): every amount is rounded to the
 * nearest 0.1 fl oz / 0.1 oz, and the rounded parts always add up exactly to
 * the rounded total:
 *   - When the TOTAL is known, the parts are split with the largest-remainder
 *     method (floor both, give the last 0.1 to the part with the bigger
 *     remainder; ties go to Part A).
 *   - When Part A (or B) is known, it is rounded first, the other part is
 *     computed from that rounded amount, and the total is their sum.
 */

export type MixBasis = "volume" | "weight";
export type KnownAmount = "total" | "a" | "b";

export const FL_OZ_PER_GALLON = 128;
export const OZ_PER_POUND = 16;

export const smallPerLarge = (basis: MixBasis) => (basis === "volume" ? FL_OZ_PER_GALLON : OZ_PER_POUND);

export type MixInput = {
  ratioA: number;
  ratioB: number;
  known: KnownAmount;
  /** The known amount in fl oz (volume) or oz (weight). */
  amount: number;
};

/** All in fl oz (volume) or oz (weight), each a multiple of 0.1, with a + b === total. */
export type MixResult = { a: number; b: number; total: number };

function positive(name: string, v: number) {
  if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`${name} must be greater than zero.`);
}

/** Rounds to whole tenths, half up (amounts are never negative). */
const toTenths = (x: number) => Math.round(x * 10 + 1e-9);

export function calculateMix(input: MixInput): MixResult {
  positive("Part A ratio", input.ratioA);
  positive("Part B ratio", input.ratioB);
  positive("Amount", input.amount);
  const { ratioA: ra, ratioB: rb } = input;
  let a: number;
  let b: number;
  if (input.known === "total") {
    const total = toTenths(input.amount);
    const exactA = (total * ra) / (ra + rb);
    const exactB = total - exactA;
    a = Math.floor(exactA + 1e-9);
    b = Math.floor(exactB + 1e-9);
    if (a + b < total) {
      if (exactA - a >= exactB - b) a += 1;
      else b += 1;
    }
  } else if (input.known === "a") {
    a = toTenths(input.amount);
    b = toTenths((a * rb) / ra / 10);
  } else {
    b = toTenths(input.amount);
    a = toTenths((b * ra) / rb / 10);
  }
  return { a: a / 10, b: b / 10, total: (a + b) / 10 };
}

/** Splits a small-unit amount into whole large units and the remainder, e.g. 160 fl oz → 1 gal 32 fl oz. */
export function splitUnits(small: number, basis: MixBasis): { large: number; small: number } {
  const per = smallPerLarge(basis);
  const tenths = toTenths(small);
  const large = Math.floor(tenths / (per * 10));
  return { large, small: (tenths - large * per * 10) / 10 };
}

/** Combines a large + small entry (e.g. 1 gal + 32 fl oz) into small units. */
export function combineUnits(large: number, small: number, basis: MixBasis): number {
  return large * smallPerLarge(basis) + small;
}
