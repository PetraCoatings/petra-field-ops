/**
 * QC results: "pass" or "fail" only when a limit exists (minimum and/or
 * maximum, inclusive). Without one, a reading is recorded but never judged.
 * The database applies the same rule (public.record_qc_measurement).
 */
export type QcResult = "pass" | "fail" | null;

export function evaluate(value: number, min: number | null, max: number | null): QcResult {
  if (min === null && max === null) return null;
  return (min === null || value >= min) && (max === null || value <= max) ? "pass" : "fail";
}

/** "≤ 75", "≥ 300", "3 to 5", or null when there is no limit. */
export function limitText(min: number | null, max: number | null, unit: string, fmt: (n: number) => string = String): string | null {
  if (min !== null && max !== null) return `${fmt(min)}–${fmt(max)} ${unit}`;
  if (max !== null) return `≤ ${fmt(max)} ${unit}`;
  if (min !== null) return `≥ ${fmt(min)} ${unit}`;
  return null;
}
