/** Parses a typed decimal ("12.5", "12,5", "-3", "1,200"). Empty → null, junk → NaN. */
export function parseDecimal(raw: string): number | null {
  let s = raw.trim().replace(/[−–]/g, "-");
  if (s === "") return null;
  s = s.replace(/^(-?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/, (_, sign, int, dec = "") => `${sign}${int.replace(/,/g, "")}${dec}`);
  s = s.replace(/^(-?\d+),(\d+)$/, "$1.$2");
  return /^-?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : Number.NaN;
}

export function formatNumber(locale: string, value: number, fractionDigits = 2): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value === 0 ? 0 : value); // avoid "-0.00"
}
