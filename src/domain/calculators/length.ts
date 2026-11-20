/**
 * Length input parsing for the calculators.
 *
 * Field crews type lengths the way a tape measure reads, so one text box
 * accepts all of these (result in decimal feet):
 *
 *   12.5        12.5'      12.5 ft      → 12.5
 *   12'6"       12' 6      12ft 6in     → 12.5
 *   12' 6 1/2"  12' 6-1/2"               → 12.541666…
 *   150"        150 in                  → 12.5
 *   12 1/2'                             → 12.5
 *
 * A bare number with no unit is decimal feet. "12 6" (two bare numbers) is
 * rejected as ambiguous rather than guessed.
 */

export type LengthError = "empty" | "invalid" | "inchesTooLarge";

export type ParsedLength = { ok: true; feet: number } | { ok: false; error: LengthError };

// A number, optionally with a fraction ("6 1/2", "6-1/2"), or a fraction alone ("1/2").
const NUM = String.raw`(?:\d+(?:\.\d+)?(?:[ -]+\d+\/\d+)?|\d+\/\d+|\.\d+)`;
const FEET_UNIT = String.raw`(?:'|ft\.?|feet|foot)`;
const INCH_UNIT = String.raw`(?:"|in\.?|inch(?:es)?)`;
const PATTERN = new RegExp(
  String.raw`^(?:(?<ft>${NUM})\s*${FEET_UNIT})?\s*(?:(?<in>${NUM})\s*(?<inUnit>${INCH_UNIT})?)?$`,
  "i",
);

function normalize(raw: string): string {
  let s = raw
    .trim()
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/''/g, '"')
    .replace(/\s+/g, " ");
  // "1,200.5" (thousands separators) → "1200.5"; "12,5" (decimal comma) → "12.5".
  s = s.replace(/\d{1,3}(?:,\d{3})+(?=\D|$)/g, (m) => m.replace(/,/g, ""));
  s = s.replace(/(\d),(\d)/g, "$1.$2");
  return s;
}

function parseNumber(token: string): number {
  const t = token.trim();
  const mixed = /^(\d+(?:\.\d+)?)[ -]+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

export function parseLength(raw: string): ParsedLength {
  const s = normalize(raw);
  if (s === "") return { ok: false, error: "empty" };
  const m = PATTERN.exec(s);
  if (!m?.groups) return { ok: false, error: "invalid" };
  const { ft, in: inch, inUnit } = m.groups;
  if (ft === undefined && inch === undefined) return { ok: false, error: "invalid" };

  const feet = ft === undefined ? 0 : parseNumber(ft);
  const inches = inch === undefined ? 0 : parseNumber(inch);
  if (!Number.isFinite(feet) || !Number.isFinite(inches)) return { ok: false, error: "invalid" };
  // A zero denominator ("1/0") yields Infinity or NaN above.

  if (ft === undefined && !inUnit) return { ok: true, feet: inches }; // bare number = decimal feet
  if (ft !== undefined && inch !== undefined && inches >= 12) return { ok: false, error: "inchesTooLarge" };
  return { ok: true, feet: feet + inches / 12 };
}

/**
 * Formats decimal feet as feet and inches to the nearest 1/8", e.g. 12.5 → 12' 6",
 * 12.5416 → 12' 6 1/2". Used to echo back how an entry was understood.
 */
export function formatFeetInches(feet: number): string {
  const eighths = Math.round(feet * 12 * 8);
  const ft = Math.floor(eighths / 96);
  const remEighths = eighths - ft * 96;
  const wholeIn = Math.floor(remEighths / 8);
  let num = remEighths - wholeIn * 8;
  let den = 8;
  while (num > 0 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const frac = num > 0 ? ` ${num}/${den}` : "";
  return `${ft}' ${wholeIn}${frac}"`;
}

/**
 * Parses a length entered in two boxes, feet and inches, as on the phone
 * screens (a number keypad has no ' or " keys). Either box may be empty:
 *
 *   ft "12"   in "6"    → 12.5        ft "12.5" in ""  → 12.5
 *   ft ""     in "18"   → 1.5         ft "12"   in "6 1/2" → 12.541666…
 *
 * Inches must be under 12 when feet are also entered. A unit symbol typed
 * into its own box ("12'" or "6 in") is ignored.
 */
export function parseFeetAndInches(feetRaw: string, inchesRaw: string): ParsedLength {
  const ft = feetRaw.replace(/\s*(?:['′’]|ft\.?|feet|foot)\s*$/i, "").trim();
  const inch = inchesRaw.replace(/\s*(?:["″”]|''|in\.?|inch(?:es)?)\s*$/i, "").trim();
  if (ft === "" && inch === "") return { ok: false, error: "empty" };
  // Each box must hold a plain number on its own (no units for the other box).
  if (/['"′″’”]|[a-z]/i.test(ft + inch)) return { ok: false, error: "invalid" };
  const composed = [ft && `${ft}'`, inch && `${inch}"`].filter(Boolean).join(" ");
  return parseLength(composed);
}
