/**
 * Calendar math in the company time zone (America/Chicago by default),
 * daylight-saving aware, using only the built-in Intl API.
 *
 * All instants are milliseconds since the epoch (UTC). A "local date" is a
 * YYYY-MM-DD string in the company time zone.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(tz, f);
  }
  return f;
}

export type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

export function localParts(instant: number, tz: string): LocalParts {
  const p: Record<string, number> = {};
  for (const { type, value } of formatter(tz).formatToParts(new Date(instant))) {
    if (type !== "literal") p[type] = Number(value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour % 24, minute: p.minute, second: p.second };
}

/** Offset of `tz` from UTC at `instant`, in ms (Chicago in winter: −6 h). */
function offsetAt(instant: number, tz: string): number {
  const p = localParts(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads the given local time.
 * During the spring-forward gap (a time that doesn't exist) it is moved
 * forward by the gap (2:30 AM → 3:30 AM); in the fall-back hour, the first occurrence.
 */
export function zonedTimeToInstant(year: number, month: number, day: number, hour: number, minute: number, tz: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetAt(guess, tz);
  const second = guess - offsetAt(first, tz);
  if (first === second) return first;
  // Ambiguous or non-existent: try both and keep the earliest that reads correctly, else the later one.
  const candidates = [Math.min(first, second), Math.max(first, second)];
  for (const c of candidates) {
    const p = localParts(c, tz);
    if (p.hour === hour && p.minute === minute && p.day === day) return c;
  }
  return Math.max(first, second);
}

export function localDate(instant: number, tz: string): string {
  const p = localParts(instant, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** ISO day of week for a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export function isoDow(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Midnight at the start of a local date, as an instant. */
export function startOfLocalDate(date: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return zonedTimeToInstant(y, m, d, 0, 0, tz);
}

export type Workweek = { startDow: number; startTime: string /* "HH:MM" */ };
export const DEFAULT_WORKWEEK: Workweek = { startDow: 1, startTime: "00:00" };

/** The start of the workweek containing `instant` (Monday 12:00 AM by default). */
export function workweekStart(instant: number, tz: string, week: Workweek = DEFAULT_WORKWEEK): number {
  const [hh, mm] = week.startTime.split(":").map(Number);
  let date = localDate(instant, tz);
  date = addDays(date, -((isoDow(date) - week.startDow + 7) % 7));
  const at = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return zonedTimeToInstant(y, m, day, hh, mm, tz);
  };
  let start = at(date);
  if (start > instant) start = at(addDays(date, -7));
  return start;
}

/** The start of the following workweek (7 calendar days later, DST-aware). */
export function nextWorkweekStart(weekStart: number, tz: string, week: Workweek = DEFAULT_WORKWEEK): number {
  const [hh, mm] = week.startTime.split(":").map(Number);
  const [y, m, d] = addDays(localDate(weekStart, tz), 7).split("-").map(Number);
  return zonedTimeToInstant(y, m, d, hh, mm, tz);
}
