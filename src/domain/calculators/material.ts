/**
 * Material quantity: how much product an area needs.
 *
 *   gallons (no waste) = area (ft²) × coats ÷ spread rate (ft²/gal)
 *   waste gallons      = gallons × waste % ÷ 100
 *   total gallons      = gallons + waste gallons
 *   kits               = total gallons ÷ kit size, rounded UP to a whole kit
 *
 * Waste is ADDED ON TOP of the theoretical amount (10% waste on 50 gal = 55 gal).
 * It is always entered by the crew and shown separately, never assumed.
 * The spread rate can come straight from the data sheet or from a mil target
 * via the Spread Rate calculator's constant (see spread-rate.ts).
 *
 * Pure functions, no rounding except whole kits.
 */

import { spreadRateFromWft } from "./spread-rate";

export type MaterialInput = {
  areaSqft: number;
  /** Spread rate per coat, ft²/gal. */
  spreadRate: number;
  coats: number;
  wastePct: number;
  /** Gallons per kit or pail. Optional. */
  kitGallons?: number;
};

export type MaterialResult = {
  baseGallons: number;
  wasteGallons: number;
  totalGallons: number;
  /** Only when a kit size was given. */
  kits?: number;
  /** Gallons left over after using what's needed from the kits. */
  leftoverGallons?: number;
};

/** Small tolerance so 10.000000000002 kits (floating-point noise) is 10, not 11. */
const KIT_EPSILON = 1e-9;

function positive(name: string, v: number) {
  if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`${name} must be greater than zero.`);
}

export function calculateMaterial(input: MaterialInput): MaterialResult {
  positive("Area", input.areaSqft);
  positive("Spread rate", input.spreadRate);
  if (!Number.isInteger(input.coats) || input.coats < 1) throw new RangeError("Coats must be a whole number, 1 or more.");
  if (!(input.wastePct >= 0 && input.wastePct < 100)) throw new RangeError("Waste must be at least 0 and less than 100%.");
  if (input.kitGallons !== undefined) positive("Kit size", input.kitGallons);

  const baseGallons = (input.areaSqft * input.coats) / input.spreadRate;
  const wasteGallons = (baseGallons * input.wastePct) / 100;
  const totalGallons = baseGallons + wasteGallons;
  const result: MaterialResult = { baseGallons, wasteGallons, totalGallons };
  if (input.kitGallons !== undefined) {
    const kits = Math.ceil(totalGallons / input.kitGallons - KIT_EPSILON);
    result.kits = kits;
    result.leftoverGallons = Math.max(0, kits * input.kitGallons - totalGallons);
  }
  return result;
}

/** Spread rate for a wet-film mil target, for when the spec gives mils instead of ft²/gal. */
export const spreadRateForWftMils = spreadRateFromWft;
