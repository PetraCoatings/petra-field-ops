/**
 * Hours from time segments: per day and per workweek, by category.
 *
 * Rules (owner decisions Q3, Q4, Q7 in docs/ARCHITECTURE_PLAN.md):
 * - Job, Drive and Ride all count as hours worked.
 * - A lunch of 30 minutes or more is unpaid. A lunch under 30 minutes is
 *   counted as paid (short breaks are generally paid time under federal rules)
 *   and flagged for review. Paid lunch counts toward the category it was taken from.
 * - Exact times, no rounding. Hours are only rounded for display.
 * - A segment crossing midnight or the start of a workweek is split there, so
 *   each day and each week gets exactly its own part.
 * - A segment still running counts up to "now". If it has been running more
 *   than 16 hours it is flagged as a likely missing clock-out.
 */
import { addDays, localDate, nextWorkweekStart, startOfLocalDate, workweekStart, type Workweek, DEFAULT_WORKWEEK } from "./zoned";

export type TimeCategory = "job" | "drive" | "ride";
export const TIME_CATEGORIES: readonly TimeCategory[] = ["job", "drive", "ride"];

export type Segment = {
  id: string;
  kind: "work" | "lunch";
  category: TimeCategory | null;
  projectId: string | null;
  start: number;
  end: number | null;
};

export type Flag = "short_lunch" | "open_lunch" | "missing_clock_out";
export const SHORT_LUNCH_MS = 30 * 60_000;
export const MISSING_CLOCK_OUT_MS = 16 * 3_600_000;

export type Hours = Record<TimeCategory, number> & { total: number; unpaidLunch: number };
const zero = (): Hours => ({ job: 0, drive: 0, ride: 0, total: 0, unpaidLunch: 0 });

export type DayTotals = { date: string; ms: Hours; flags: { segmentId: string; flag: Flag }[] };

/** Flags for one segment, judged on its whole length (before any split). */
export function segmentFlags(s: Segment, now: number): Flag[] {
  const flags: Flag[] = [];
  const end = s.end ?? now;
  if (s.kind === "lunch") {
    if (s.end === null) flags.push("open_lunch");
    else if (end - s.start < SHORT_LUNCH_MS) flags.push("short_lunch");
  }
  if (s.end === null && now - s.start > MISSING_CLOCK_OUT_MS) flags.push("missing_clock_out");
  return flags;
}

/** Is this lunch paid? Only a finished lunch under 30 minutes is. */
export function isPaidLunch(s: Segment): boolean {
  return s.kind === "lunch" && s.end !== null && s.end - s.start < SHORT_LUNCH_MS;
}

/** Splits [start, end) at every local midnight in `tz`. */
export function splitByDay(start: number, end: number, tz: string): { date: string; start: number; end: number }[] {
  const out: { date: string; start: number; end: number }[] = [];
  let cur = start;
  while (cur < end) {
    const date = localDate(cur, tz);
    const next = Math.min(end, startOfLocalDate(addDays(date, 1), tz));
    out.push({ date, start: cur, end: next });
    cur = next;
  }
  return out;
}

function add(h: Hours, s: Segment, ms: number) {
  if (s.kind === "work" || isPaidLunch(s)) {
    const cat = s.category ?? "job";
    h[cat] += ms;
    h.total += ms;
  } else {
    h.unpaidLunch += ms;
  }
}

/** Milliseconds per local day, by category, for the segments overlapping [from, to). */
export function dailyTotals(segments: readonly Segment[], now: number, tz: string, from: number, to: number): DayTotals[] {
  const days = new Map<string, DayTotals>();
  for (const s of segments) {
    const start = Math.max(s.start, from);
    const end = Math.min(s.end ?? now, to);
    if (end <= start) continue;
    const pieces = splitByDay(start, end, tz);
    for (const p of pieces) {
      let d = days.get(p.date);
      if (!d) days.set(p.date, (d = { date: p.date, ms: zero(), flags: [] }));
      add(d.ms, s, p.end - p.start);
    }
    // Flags go on the day the segment started (or the first day shown).
    const first = days.get(pieces[0].date)!;
    for (const flag of segmentFlags(s, now)) first.flags.push({ segmentId: s.id, flag });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export type WeekTotals = { weekStart: number; weekEnd: number; ms: Hours; days: DayTotals[] };

/** Totals for the workweek containing `instant`. */
export function weekTotals(
  segments: readonly Segment[],
  now: number,
  tz: string,
  instant: number = now,
  week: Workweek = DEFAULT_WORKWEEK,
): WeekTotals {
  const weekStart = workweekStart(instant, tz, week);
  const weekEnd = nextWorkweekStart(weekStart, tz, week);
  const days = dailyTotals(segments, now, tz, weekStart, weekEnd);
  const ms = zero();
  for (const d of days) for (const k of Object.keys(ms) as (keyof Hours)[]) ms[k] += d.ms[k];
  return { weekStart, weekEnd, ms, days };
}

/** Hours (decimal) from milliseconds, unrounded. */
export const toHours = (ms: number) => ms / 3_600_000;

/** "9 h 15 min" style parts, rounded down to the minute (display only). */
export function hoursMinutes(ms: number): { h: number; m: number } {
  const minutes = Math.floor(ms / 60_000);
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}
