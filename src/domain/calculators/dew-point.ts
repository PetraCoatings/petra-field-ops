/**
 * Dew point and the substrate-temperature check before coating.
 *
 * Formula: Magnus approximation with the Alduchov & Eskridge (1996)
 * coefficients, a = 17.625 and b = 243.04 °C:
 *
 *   γ  = ln(RH / 100) + a·T / (b + T)
 *   Td = b·γ / (a − γ)                       (T and Td in °C)
 *
 * Alduchov & Eskridge report these coefficients accurate to within about
 * 0.4 °C (0.7 °F) for air temperatures from −40 °C to +50 °C (−40 °F to
 * 122 °F). Outside that range the result is still shown but flagged.
 *
 * Substrate check: coating is acceptable only when the substrate is at least
 * the margin above the dew point. The margin comes from the product data sheet
 * when it has one, otherwise from the company setting (default 5 °F).
 *
 * Rounding: field thermometers and hygrometers read to 0.1°, so the dew point
 * is rounded to 0.1° (half away from zero) and the spread is computed from that
 * rounded value. The pass/fail check uses exactly the numbers on the screen, so
 * a displayed "5.0° above" never shows as a failure against a 5° margin.
 */

export const DEW_POINT_FORMULA_VERSION = "magnus-alduchov-eskridge-1996";
export const MAGNUS_A = 17.625;
export const MAGNUS_B_C = 243.04;
export const MAGNUS_VALID_MIN_C = -40;
export const MAGNUS_VALID_MAX_C = 50;
export const DEFAULT_DEW_POINT_MARGIN_F = 5;

export type TempUnit = "F" | "C";

export const fToC = (f: number) => ((f - 32) * 5) / 9;
export const cToF = (c: number) => (c * 9) / 5 + 32;
/** Converts a temperature DIFFERENCE (not a reading). 5 °F of difference = 2.78 °C. */
export const deltaFToC = (df: number) => (df * 5) / 9;
export const deltaCToF = (dc: number) => (dc * 9) / 5;

export const toC = (value: number, unit: TempUnit) => (unit === "C" ? value : fToC(value));
export const fromC = (c: number, unit: TempUnit) => (unit === "C" ? c : cToF(c));

/** Dew point in °C from air temperature (°C) and relative humidity (%, 0 < RH ≤ 100). */
export function dewPointC(airTempC: number, relativeHumidityPct: number): number {
  if (!(relativeHumidityPct > 0 && relativeHumidityPct <= 100)) {
    throw new RangeError("Relative humidity must be greater than 0 and at most 100.");
  }
  const gamma = magnusGamma(airTempC, relativeHumidityPct);
  return (MAGNUS_B_C * gamma) / (MAGNUS_A - gamma);
}

/** The intermediate γ term of the Magnus formula (shown in "Show the math"). */
export function magnusGamma(airTempC: number, relativeHumidityPct: number): number {
  return Math.log(relativeHumidityPct / 100) + (MAGNUS_A * airTempC) / (MAGNUS_B_C + airTempC);
}

/**
 * ok           substrate is at least the margin above the dew point
 * belowMargin  substrate is above the dew point but by less than the margin: don't coat
 * condensation substrate is at or below the dew point: moisture is forming on it
 */
export type SubstrateStatus = "ok" | "belowMargin" | "condensation";

export type DewPointInput = {
  unit: TempUnit;
  airTemp: number;
  relativeHumidity: number;
  /** Optional: without it only the dew point is reported. */
  substrateTemp?: number;
  /** Required margin in °F (company setting or product data sheet). */
  marginF: number;
};

export type DewPointResult = {
  unit: TempUnit;
  /** All temperatures below are in `unit`. Rounded to 0.1°. */
  dewPoint: number;
  /** Unrounded dew point, for "show the math". */
  dewPointExact: number;
  margin: number;
  /** Lowest substrate temperature that passes: dew point + margin. */
  minimumSubstrate: number;
  /** substrate − dew point (rounded), when substrate was given. Rounded to 0.1°. */
  spread?: number;
  status?: SubstrateStatus;
  /** Air temperature is outside the range the formula's coefficients were fitted to. */
  outsideFormulaRange: boolean;
  formulaVersion: typeof DEW_POINT_FORMULA_VERSION;
};

/** Rounds to one decimal, half away from zero (−0.05 → −0.1, 0.05 → 0.1). */
export function round1(x: number): number {
  const r = Math.sign(x) * Math.round(Math.abs(x) * 10 + 1e-9) / 10;
  return r === 0 ? 0 : r; // no "-0"
}

export function substrateStatus(spread: number, margin: number): SubstrateStatus {
  if (spread <= 0) return "condensation";
  return spread < margin ? "belowMargin" : "ok";
}

export function calculateDewPoint(input: DewPointInput): DewPointResult {
  const { unit } = input;
  if (!(input.marginF >= 0)) throw new RangeError("Margin must be zero or more.");
  const airC = toC(input.airTemp, unit);
  const dewC = dewPointC(airC, input.relativeHumidity);
  const dewPointExact = fromC(dewC, unit);
  const dewPoint = round1(dewPointExact);
  const margin = round1(unit === "F" ? input.marginF : deltaFToC(input.marginF));
  const result: DewPointResult = {
    unit,
    dewPoint,
    dewPointExact,
    margin,
    minimumSubstrate: round1(dewPoint + margin),
    outsideFormulaRange: airC < MAGNUS_VALID_MIN_C || airC > MAGNUS_VALID_MAX_C,
    formulaVersion: DEW_POINT_FORMULA_VERSION,
  };
  if (input.substrateTemp !== undefined) {
    const spread = round1(input.substrateTemp - dewPoint);
    result.spread = spread;
    result.status = substrateStatus(spread, margin);
  }
  return result;
}
