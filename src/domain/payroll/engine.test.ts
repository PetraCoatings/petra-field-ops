import { describe, expect, it } from "vitest";
import { payPeriod, payWeek, roundHalfUp, type RateRow } from "./engine";
import type { Segment } from "@/domain/time/totals";
import { zonedTimeToInstant } from "@/domain/time/zoned";

const TZ = "America/Chicago";
const at = (date: string, hhmm: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return zonedTimeToInstant(y, m, d, hh, mm, TZ);
};
let n = 0;
const work = (category: Segment["category"], start: number, end: number | null): Segment => ({ id: `s${++n}`, kind: "work", category, projectId: null, start, end });
const lunch = (start: number, end: number | null): Segment => ({ id: `s${++n}`, kind: "lunch", category: "job", projectId: null, start, end });
const H = 3_600_000;
const RATES: RateRow[] = [
  { category: "job", cents: 2500, effectiveFrom: "2026-01-01" },
  { category: "drive", cents: 1800, effectiveFrom: "2026-01-01" },
  { category: "ride", cents: 1500, effectiveFrom: "2026-01-01" },
];
const MON = "2026-11-23"; // a Monday
const day = (i: number) => {
  const d = new Date(`${MON}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};
const week = (segments: Segment[], rates = RATES, extra = {}) => payWeek({ segments, rates, tz: TZ, minimumWageCents: 725, ...extra }, at(MON, "00:00"));

describe("rounding", () => {
  it("rounds half up to the cent", () => {
    expect(roundHalfUp(BigInt(1801800), BigInt(3600))).toBe(BigInt(501)); // 500.5 → 501
    expect(roundHalfUp(BigInt(1798200), BigInt(3600))).toBe(BigInt(500)); // 499.5 → 500
    expect(roundHalfUp(BigInt(1797840), BigInt(3600))).toBe(BigInt(499)); // 499.4 → 499
  });
});

describe("the plan's verified example ($1,211.17)", () => {
  it("Job 38 h × $25, Drive 6 h × $18, Ride 4 h × $15", () => {
    // Job 38 h: Mon–Thu 9.5 h each. Drive 6 h on Fri, Ride 4 h on Sat.
    const segs = [0, 1, 2, 3].map((i) => work("job", at(day(i), "06:00"), at(day(i), "15:30")));
    segs.push(work("drive", at(day(4), "06:00"), at(day(4), "12:00")), work("ride", at(day(5), "08:00"), at(day(5), "12:00")));
    const w = week(segs);
    expect(w.seconds).toEqual({ job: 38 * 3600, drive: 6 * 3600, ride: 4 * 3600 });
    expect(w.lines.map((l) => [l.category, l.cents, l.amountCents])).toEqual([
      ["job", 2500, 95000],
      ["drive", 1800, 10800],
      ["ride", 1500, 6000],
    ]);
    expect(w.straightTimeCents).toBe(111800); // $1,118.00
    expect(w.totalSeconds / 3600).toBe(48);
    expect(w.regularRateCents).toBe(2329.1667); // $23.291666…
    expect(w.overtimeSeconds / 3600).toBe(8);
    expect(w.regularSeconds / 3600).toBe(40);
    expect(w.overtimePremiumCents).toBe(9317); // $93.1666… → $93.17
    expect(w.grossCents).toBe(121117); // $1,211.17
    expect(w.blocked).toBe(false);
  });
});

describe("cases", () => {
  it("no overtime: 40 hours of Job", () => {
    const w = week([0, 1, 2, 3, 4].map((i) => work("job", at(day(i), "07:00"), at(day(i), "15:00"))));
    expect([w.straightTimeCents, w.overtimeSeconds, w.overtimePremiumCents, w.grossCents]).toEqual([100000, 0, 0, 100000]);
  });

  it("an overnight shift counts fully in its week", () => {
    const w = week([work("job", at(day(1), "22:00"), at(day(2), "06:00"))]);
    expect(w.totalSeconds / 3600).toBe(8);
    expect(w.grossCents).toBe(20000);
  });

  it("a shift crossing into the next workweek is split there", () => {
    // 38 h earlier in the week, then Sunday 8 PM → Monday 4 AM.
    const segs = [0, 1, 2, 3].map((i) => work("job", at(day(i), "06:00"), at(day(i), "15:30")));
    segs.push(work("job", at(day(6), "20:00"), at(day(7), "04:00")));
    const p = payPeriod({ segments: segs, rates: RATES, tz: TZ, periodStart: at(MON, "12:00"), weeks: 2 });
    expect(p.weeks.map((w) => [w.totalSeconds / 3600, w.overtimeSeconds / 3600])).toEqual([
      [42, 2],
      [4, 0],
    ]);
    // Week 1: 42 h × $25 = $1,050 + 2 × $25 × ½ = $25 → $1,075. Week 2: 4 × $25 = $100.
    expect(p.weeks.map((w) => w.grossCents)).toEqual([107500, 10000]);
  });

  it("a raise in the middle of the week prices each hour at the rate in effect", () => {
    const rates = [...RATES, { category: "job" as const, cents: 2700, effectiveFrom: day(2) }];
    const segs = [0, 1, 2, 3, 4].map((i) => work("job", at(day(i), "07:00"), at(day(i), "15:00")));
    segs.push(work("job", at(day(5), "07:00"), at(day(5), "11:00")));
    const w = week(segs, rates);
    // Mon–Tue 16 h × $25 = $400; Wed–Sat 28 h × $27 = $756 → $1,156 for 44 h.
    expect(w.lines.map((l) => [l.cents, l.seconds / 3600])).toEqual([
      [2500, 16],
      [2700, 28],
    ]);
    expect(w.straightTimeCents).toBe(115600);
    // Regular rate $1,156 / 44 = $26.2727…; premium 4 × 26.2727… × ½ = $52.5454… → $52.55
    expect(w.overtimePremiumCents).toBe(5255);
    expect(w.grossCents).toBe(120855); // $1,208.5454… → $1,208.55
  });

  it("lunch of 30 minutes or more is unpaid; under 30 is paid and noted", () => {
    const d = day(0);
    const w = week([
      work("job", at(d, "06:00"), at(d, "11:30")),
      lunch(at(d, "11:30"), at(d, "12:00")), // 30 min: unpaid
      work("job", at(d, "12:00"), at(d, "15:00")),
      lunch(at(d, "15:00"), at(d, "15:15")), // 15 min: paid
      work("job", at(d, "15:15"), at(d, "16:30")),
    ]);
    expect(w.totalSeconds / 3600).toBe(10);
    expect(w.grossCents).toBe(25000);
    expect(w.exceptions.map((e) => e.kind)).toEqual(["short_lunch_paid"]);
  });

  it("an entry without a clock-out is left out, reported, and blocks the week", () => {
    const w = week([work("job", at(day(0), "07:00"), at(day(0), "15:00")), work("job", at(day(1), "07:00"), null)]);
    expect(w.totalSeconds / 3600).toBe(8);
    expect(w.exceptions.map((e) => e.kind)).toEqual(["open_entry"]);
    expect(w.blocked).toBe(true);
  });

  it("a pay period of two weeks: overtime is per week, never averaged across them", () => {
    const segs = [0, 1, 2, 3, 4].map((i) => work("job", at(day(i), "06:00"), at(day(i), "15:00"))); // 45 h
    segs.push(...[7, 8, 9, 10, 11].map((i) => work("job", at(day(i), "08:00"), at(day(i), "15:00")))); // 35 h
    const p = payPeriod({ segments: segs, rates: RATES, tz: TZ, periodStart: at(MON, "00:00"), weeks: 2 });
    expect(p.weeks.map((w) => [w.totalSeconds / 3600, w.overtimeSeconds / 3600, w.grossCents])).toEqual([
      [45, 5, 118750], // 45 × 25 = 1,125 + 5 × 25 × ½ = 62.50
      [35, 0, 87500],
    ]);
    expect(p.grossCents).toBe(206250);
  });

  it("exempt staff record time but get no overtime", () => {
    const segs = [0, 1, 2, 3, 4].map((i) => work("job", at(day(i), "06:00"), at(day(i), "16:00"))); // 50 h
    const w = week(segs, RATES, { exempt: true });
    expect([w.overtimeSeconds, w.grossCents]).toEqual([0, 125000]);
  });

  it("a missing rate blocks the week; a rate under minimum wage is flagged, not blocked", () => {
    const missing = week([work("ride", at(day(0), "07:00"), at(day(0), "09:00"))], [RATES[0]]);
    expect(missing.exceptions).toEqual([{ kind: "missing_rate", category: "ride", date: day(0) }]);
    expect(missing.blocked).toBe(true);
    const low = week([work("job", at(day(0), "07:00"), at(day(0), "09:00"))], [{ category: "job", cents: 700, effectiveFrom: "2026-01-01" }]);
    expect(low.exceptions.map((e) => e.kind)).toEqual(["below_minimum_wage"]);
    expect(low.blocked).toBe(false);
  });

  it("exact seconds: 30 minutes at $10.01 is $5.005 → $5.01", () => {
    const w = week([work("job", at(day(0), "07:00"), at(day(0), "07:30"))], [{ category: "job", cents: 1001, effectiveFrom: "2026-01-01" }]);
    expect(w.grossCents).toBe(501);
  });
});
