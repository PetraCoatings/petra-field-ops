/**
 * Payroll engine: Job, Drive and Ride hourly pay plus weighted-average
 * overtime (docs/ARCHITECTURE_PLAN.md §7, owner decisions Q1–Q7).
 *
 * Per person, per workweek (Monday 12:00 AM, company time zone):
 *   straight time  = Σ hours × the rate in effect at that moment for that category
 *   total hours    = Job + Drive + Ride (+ lunches under 30 minutes, which are paid)
 *   regular rate   = straight time ÷ total hours
 *   overtime hours = max(0, total hours − 40)            (nonexempt only)
 *   OT premium     = overtime hours × regular rate × 0.5
 *   gross          = straight time + OT premium
 *
 * Exact arithmetic: time is whole seconds and rates are whole cents, so every
 * intermediate value is an exact fraction (BigInt). Money is rounded to the
 * cent, half up, once per output; gross is rounded from the exact value.
 * Nothing is guessed: entries without a clock-out are left out and reported,
 * and a missing rate blocks the week.
 */
import { isPaidLunch, splitByDay, type Segment, type TimeCategory, TIME_CATEGORIES } from "@/domain/time/totals";
import { localDate, nextWorkweekStart, workweekStart, type Workweek, DEFAULT_WORKWEEK } from "@/domain/time/zoned";

export const OVERTIME_THRESHOLD_SECONDS = 40 * 3600;
export const PAYROLL_ENGINE_VERSION = "payroll-2026-11-1";

export type RateRow = { id?: string; category: TimeCategory; cents: number; effectiveFrom: string /* YYYY-MM-DD */ };

export type PayException =
  | { kind: "open_entry"; segmentId: string; start: number }
  | { kind: "missing_rate"; category: TimeCategory; date: string }
  | { kind: "below_minimum_wage"; category: TimeCategory; cents: number; date: string }
  | { kind: "short_lunch_paid"; segmentId: string; start: number };

export type PayLine = { category: TimeCategory; cents: number; rateId?: string; seconds: number; amountCents: number /* rounded */ };

export type WeekPay = {
  weekStart: number;
  weekEnd: number;
  seconds: Record<TimeCategory, number>;
  totalSeconds: number;
  regularSeconds: number;
  overtimeSeconds: number;
  lines: PayLine[];
  straightTimeCents: number;
  /** Cents per hour, to 4 decimals (display only; the math uses the exact value). */
  regularRateCents: number;
  overtimePremiumCents: number;
  grossCents: number;
  exceptions: PayException[];
  /** True when something blocks approving this week (open entry, missing rate). */
  blocked: boolean;
};

export type PayInput = {
  segments: readonly Segment[];
  rates: readonly RateRow[];
  tz: string;
  workweek?: Workweek;
  /** Any instant in the first week of the pay period. */
  periodStart: number;
  weeks: number;
  exempt?: boolean;
  minimumWageCents?: number;
};

/** Rounds a positive fraction num/den to the nearest whole number, half up. */
export function roundHalfUp(num: bigint, den: bigint): bigint {
  if (den <= BigInt(0)) throw new RangeError("Denominator must be positive.");
  const two = BigInt(2);
  return num >= BigInt(0) ? (two * num + den) / (two * den) : -((two * -num + den) / (two * den));
}

/** The rate in effect for a category on a local date: the latest one starting on or before it. */
export function rateOn(rates: readonly RateRow[], category: TimeCategory, date: string): RateRow | undefined {
  let best: RateRow | undefined;
  for (const r of rates) {
    if (r.category === category && r.effectiveFrom <= date && (!best || r.effectiveFrom > best.effectiveFrom)) best = r;
  }
  return best;
}

export function payWeek(input: Omit<PayInput, "periodStart" | "weeks">, weekStart: number): WeekPay {
  const week = input.workweek ?? DEFAULT_WORKWEEK;
  const weekEnd = nextWorkweekStart(weekStart, input.tz, week);
  const exceptions: PayException[] = [];
  const seconds: Record<TimeCategory, number> = { job: 0, drive: 0, ride: 0 };
  const lines = new Map<string, { category: TimeCategory; cents: number; rateId?: string; seconds: number }>();
  const missing = new Set<string>();
  const low = new Set<string>();

  for (const s of input.segments) {
    if (s.start >= weekEnd || (s.end !== null && s.end <= weekStart)) continue;
    if (s.end === null) {
      if (s.start < weekEnd) exceptions.push({ kind: "open_entry", segmentId: s.id, start: s.start });
      continue;
    }
    const paid = s.kind === "work" || isPaidLunch(s);
    if (!paid) continue;
    if (s.kind === "lunch" && s.start >= weekStart) exceptions.push({ kind: "short_lunch_paid", segmentId: s.id, start: s.start });
    const category = s.category ?? "job";
    // Whole seconds, so the arithmetic is exact (clock times are to the second or better).
    for (const piece of splitByDay(Math.max(s.start, weekStart), Math.min(s.end, weekEnd), input.tz)) {
      const secs = Math.round(piece.end / 1000) - Math.round(piece.start / 1000);
      if (secs <= 0) continue;
      seconds[category] += secs;
      if (input.exempt) continue; // salaried: hours tracked, no hourly pay
      const rate = rateOn(input.rates, category, piece.date);
      if (!rate) {
        if (!missing.has(`${category}|${piece.date}`)) exceptions.push({ kind: "missing_rate", category, date: piece.date });
        missing.add(`${category}|${piece.date}`);
        continue;
      }
      if (input.minimumWageCents !== undefined && rate.cents < input.minimumWageCents && !low.has(`${category}|${rate.effectiveFrom}`)) {
        low.add(`${category}|${rate.effectiveFrom}`);
        exceptions.push({ kind: "below_minimum_wage", category, cents: rate.cents, date: piece.date });
      }
      const key = `${category}|${rate.cents}|${rate.effectiveFrom}`;
      const line = lines.get(key) ?? { category, cents: rate.cents, rateId: rate.id, seconds: 0 };
      line.seconds += secs;
      lines.set(key, line);
    }
  }

  const totalSeconds = TIME_CATEGORIES.reduce((n, c) => n + seconds[c], 0);
  const overtimeSeconds = input.exempt ? 0 : Math.max(0, totalSeconds - OVERTIME_THRESHOLD_SECONDS);
  const H = BigInt(3600);
  // Straight time in cent-seconds (cents per hour × seconds): exact.
  const S = [...lines.values()].reduce((n, l) => n + BigInt(l.cents) * BigInt(l.seconds), BigInt(0));
  const T = BigInt(totalSeconds);
  const O = BigInt(overtimeSeconds);
  let straightTimeCents = 0;
  let premium = 0;
  let gross = 0;
  let regularRate = 0;
  if (totalSeconds > 0) {
    straightTimeCents = Number(roundHalfUp(S, H));
    // premium = O × (S / T) × ½, in cent-seconds → ÷ 3600 for cents
    premium = Number(roundHalfUp(O * S, BigInt(2) * T * H));
    // gross = S + O·S/(2T) = S·(2T + O) / (2T), in cent-seconds
    gross = Number(roundHalfUp(S * (BigInt(2) * T + O), BigInt(2) * T * H));
    regularRate = Number(roundHalfUp(S * BigInt(10_000), T)) / 10_000;
  }
  return {
    weekStart,
    weekEnd,
    seconds,
    totalSeconds,
    regularSeconds: totalSeconds - overtimeSeconds,
    overtimeSeconds,
    lines: [...lines.values()]
      .sort((a, b) => TIME_CATEGORIES.indexOf(a.category) - TIME_CATEGORIES.indexOf(b.category) || a.cents - b.cents)
      .map((l) => ({ ...l, amountCents: Number(roundHalfUp(BigInt(l.cents) * BigInt(l.seconds), H)) })),
    straightTimeCents,
    regularRateCents: regularRate,
    overtimePremiumCents: premium,
    grossCents: gross,
    exceptions,
    blocked: exceptions.some((e) => e.kind === "open_entry" || e.kind === "missing_rate"),
  };
}

/** A pay period: each workweek computed on its own (overtime is never averaged across weeks). */
export function payPeriod(input: PayInput): { weeks: WeekPay[]; grossCents: number; blocked: boolean } {
  const week = input.workweek ?? DEFAULT_WORKWEEK;
  const weeks: WeekPay[] = [];
  let start = workweekStart(input.periodStart, input.tz, week);
  for (let i = 0; i < input.weeks; i++) {
    weeks.push(payWeek(input, start));
    start = nextWorkweekStart(start, input.tz, week);
  }
  return { weeks, grossCents: weeks.reduce((n, w) => n + w.grossCents, 0), blocked: weeks.some((w) => w.blocked) };
}

/** Local date of the first day of a week, for labels. */
export const weekLabelDate = (w: WeekPay, tz: string) => localDate(w.weekStart, tz);

// -----------------------------------------------------------------------------
// What the office manager types into Gusto (owner decision Q6a)
// -----------------------------------------------------------------------------
// Gusto has three rates per person (Job, Drive, Ride) and takes hours per rate
// per week, to two decimals; Gusto itself calculates weighted-average overtime.
// So the entry sheet lists hours per rate (rounded half up to 0.01 h) and the
// check figure is computed from exactly those rounded hours, the way Gusto
// will, so the two can be compared.

export type GustoEntry = { category: TimeCategory; cents: number; hundredths: number /* 0.01 h */ };
export type GustoWeek = {
  entries: GustoEntry[];
  totalHundredths: number;
  regularHundredths: number;
  overtimeHundredths: number;
  /** Expected gross from the entered hours (null for salaried). */
  checkGrossCents: number | null;
};

export function gustoWeek(w: WeekPay, exempt = false): GustoWeek {
  const entries = w.lines
    .map((l) => ({ category: l.category, cents: l.cents, hundredths: Number(roundHalfUp(BigInt(l.seconds) * BigInt(100), BigInt(3600))) }))
    .filter((e) => e.hundredths > 0);
  // Salaried people have no rates: their hours still count, by category.
  if (exempt) {
    const byCat = TIME_CATEGORIES.map((c) => ({ category: c, cents: 0, hundredths: Number(roundHalfUp(BigInt(w.seconds[c]) * BigInt(100), BigInt(3600))) })).filter(
      (e) => e.hundredths > 0,
    );
    const total = byCat.reduce((n, e) => n + e.hundredths, 0);
    return { entries: byCat, totalHundredths: total, regularHundredths: total, overtimeHundredths: 0, checkGrossCents: null };
  }
  const T = entries.reduce((n, e) => n + e.hundredths, 0);
  const O = Math.max(0, T - 4000);
  let check = 0;
  if (T > 0) {
    const S = entries.reduce((n, e) => n + BigInt(e.hundredths) * BigInt(e.cents), BigInt(0)); // cent-hundredths
    check = Number(roundHalfUp(S * (BigInt(2) * BigInt(T) + BigInt(O)), BigInt(2) * BigInt(T) * BigInt(100)));
  }
  return { entries, totalHundredths: T, regularHundredths: T - O, overtimeHundredths: O, checkGrossCents: check };
}

/** The pay period containing a local date: `weeks` weeks from the anchor Monday (YYYY-MM-DD). */
export function payPeriodContaining(date: string, anchor: string, weeks: number): { start: string; end: string /* last day */; next: string; prev: string } {
  const day = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))) / 86_400_000;
  const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
  const len = weeks * 7;
  const offset = day(date) - day(anchor);
  const start = day(anchor) + Math.floor(offset / len) * len;
  return { start: iso(start), end: iso(start + len - 1), next: iso(start + len), prev: iso(start - len) };
}
