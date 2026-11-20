/**
 * A Postgres `date` ("2026-12-01") is a calendar day with no time zone.
 * Parse it at noon UTC so formatting in any US time zone shows the same day.
 */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
