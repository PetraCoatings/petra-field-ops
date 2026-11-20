/**
 * Spread rate (coverage) ↔ film thickness (mils).
 *
 * One US gallon is 231 in³. Spread over 1 ft² (144 in²) at 1 mil (0.001 in)
 * takes 0.144 in³, so one gallon covers 231 ÷ 0.144 = 1604.1666… ft² at 1 mil.
 * The owner chose this exact constant over the rounded 1600 (decision Q15):
 *
 *   WFT (mils)        = 1604.17 ÷ spread rate (ft²/gal)
 *   spread rate       = 1604.17 ÷ WFT
 *   DFT               = WFT × volume solids % ÷ 100
 *   WFT               = DFT ÷ (volume solids % ÷ 100)
 *   practical coverage = theoretical coverage × (1 − loss % ÷ 100)
 *
 * Theoretical numbers assume every drop ends up on a smooth floor. The loss %
 * covers mixing and application waste, surface profile and porosity. The crew
 * enters it explicitly; it is never assumed.
 *
 * Pure functions, no rounding: the screen rounds for display only.
 */

export const IN3_PER_GALLON = 231;
export const IN3_PER_SQFT_MIL = 0.144;
/** ft² one US gallon covers at 1 mil: 1604.1666… (shown as 1604.17). */
export const SQFT_MILS_PER_GALLON = IN3_PER_GALLON / IN3_PER_SQFT_MIL;

export type FilmBasis = "wft" | "dft";

export function wftFromSpreadRate(sqftPerGal: number): number {
  return SQFT_MILS_PER_GALLON / sqftPerGal;
}

export function spreadRateFromWft(wftMils: number): number {
  return SQFT_MILS_PER_GALLON / wftMils;
}

export function dftFromWft(wftMils: number, volumeSolidsPct: number): number {
  return (wftMils * volumeSolidsPct) / 100;
}

export function wftFromDft(dftMils: number, volumeSolidsPct: number): number {
  return dftMils / (volumeSolidsPct / 100);
}

function assertPositive(name: string, v: number) {
  if (!(v > 0) || !Number.isFinite(v)) throw new RangeError(`${name} must be greater than zero.`);
}
function assertVolumeSolids(v: number | undefined) {
  if (v !== undefined && !(v > 0 && v <= 100)) throw new RangeError("Volume solids must be more than 0 and at most 100%.");
}
function assertLoss(v: number | undefined) {
  if (v !== undefined && !(v >= 0 && v < 100)) throw new RangeError("Loss must be at least 0 and less than 100%.");
}

export type FromSpreadRateResult = {
  wft: number;
  /** Only when volume solids are known. */
  dft?: number;
};

/** "We're putting it down at 200 ft²/gal: how thick is that?" */
export function fromSpreadRate(input: { spreadRate: number; volumeSolidsPct?: number }): FromSpreadRateResult {
  assertPositive("Spread rate", input.spreadRate);
  assertVolumeSolids(input.volumeSolidsPct);
  const wft = wftFromSpreadRate(input.spreadRate);
  return input.volumeSolidsPct === undefined ? { wft } : { wft, dft: dftFromWft(wft, input.volumeSolidsPct) };
}

export type FromMilsResult = {
  wft: number;
  dft?: number;
  /** Theoretical coverage, ft²/gal. */
  spreadRate: number;
  /** Coverage after the entered loss, ft²/gal. Only when a loss % was entered. */
  practicalSpreadRate?: number;
};

/**
 * "The spec says 10 mils: what spread rate is that?" A DFT target needs the
 * product's volume solids to get back to wet film, which sets the coverage.
 */
export function fromMils(input: {
  mils: number;
  basis: FilmBasis;
  volumeSolidsPct?: number;
  lossPct?: number;
}): FromMilsResult {
  assertPositive("Mils", input.mils);
  assertVolumeSolids(input.volumeSolidsPct);
  assertLoss(input.lossPct);
  const vs = input.volumeSolidsPct;
  if (input.basis === "dft" && vs === undefined) {
    throw new RangeError("A dry film target needs the product's volume solids.");
  }
  const wft = input.basis === "wft" ? input.mils : wftFromDft(input.mils, vs!);
  const dft = input.basis === "dft" ? input.mils : vs === undefined ? undefined : dftFromWft(wft, vs);
  const spreadRate = spreadRateFromWft(wft);
  const result: FromMilsResult = { wft, spreadRate };
  if (dft !== undefined) result.dft = dft;
  if (input.lossPct !== undefined) result.practicalSpreadRate = spreadRate * (1 - input.lossPct / 100);
  return result;
}
