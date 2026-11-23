import { describe, expect, it } from "vitest";
import { dailyTotals, segmentFlags, toHours, weekTotals, type Segment } from "./totals";
import { localDate, workweekStart, zonedTimeToInstant } from "./zoned";

const TZ = "America/Chicago";
/** A Chicago wall-clock time. */
const at = (date: string, hhmm: string) => {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return zonedTimeToInstant(y, m, d, hh, mm, TZ);
};
let n = 0;
const seg = (kind: Segment["kind"], category: Segment["category"], start: number, end: number | null): Segment => ({
  id: `s${++n}`,
  kind,
  category,
  projectId: null,
  start,
  end,
});
const hrs = (ms: number) => Math.round(toHours(ms) * 1e6) / 1e6;

describe("company time zone", () => {
  it("converts Chicago wall-clock times, including daylight saving", () => {
    expect(new Date(at("2026-11-23", "06:00")).toISOString()).toBe("2026-11-23T12:00:00.000Z"); // CST, UTC−6
    expect(new Date(at("2026-07-06", "06:00")).toISOString()).toBe("2026-07-06T11:00:00.000Z"); // CDT, UTC−5
    expect(new Date(at("2026-03-08", "02:30")).toISOString()).toBe("2026-03-08T08:30:00.000Z"); // doesn't exist → 3:30 CDT
    expect(new Date(at("2026-11-01", "01:30")).toISOString()).toBe("2026-11-01T06:30:00.000Z"); // first 1:30 (CDT)
  });

  it("finds the workweek start: Monday 12:00 AM", () => {
    const monday = at("2026-11-23", "00:00");
    expect(workweekStart(at("2026-11-25", "14:00"), TZ)).toBe(monday);
    expect(workweekStart(monday, TZ)).toBe(monday);
    expect(workweekStart(at("2026-11-29", "23:59"), TZ)).toBe(monday); // Sunday night is still this week
    expect(workweekStart(at("2026-11-23", "00:00") - 1, TZ)).toBe(at("2026-11-16", "00:00"));
    expect(localDate(workweekStart(at("2026-11-04", "09:00"), TZ), TZ)).toBe("2026-11-02"); // week after fall-back
  });
});

describe("hours", () => {
  it("the 6:00 / 7:15 / 4:30 / 5:45 day: 2.5 h drive, 9.25 h job", () => {
    const d = "2026-11-23";
    const segs = [
      seg("work", "drive", at(d, "06:00"), at(d, "07:15")),
      seg("work", "job", at(d, "07:15"), at(d, "16:30")),
      seg("work", "drive", at(d, "16:30"), at(d, "17:45")),
    ];
    const [day] = dailyTotals(segs, at(d, "20:00"), TZ, at(d, "00:00"), at("2026-11-24", "00:00"));
    expect(day.date).toBe(d);
    expect([hrs(day.ms.drive), hrs(day.ms.job), hrs(day.ms.ride), hrs(day.ms.total)]).toEqual([2.5, 9.25, 0, 11.75]);
  });

  it("splits a shift at midnight: each day gets its own part", () => {
    const segs = [seg("work", "job", at("2026-11-24", "22:00"), at("2026-11-25", "02:30"))];
    const days = dailyTotals(segs, at("2026-11-26", "00:00"), TZ, at("2026-11-23", "00:00"), at("2026-11-30", "00:00"));
    expect(days.map((d) => [d.date, hrs(d.ms.job)])).toEqual([
      ["2026-11-24", 2],
      ["2026-11-25", 2.5],
    ]);
  });

  it("splits a shift at the workweek boundary (Sunday night into Monday)", () => {
    const segs = [seg("work", "drive", at("2026-11-29", "21:00"), at("2026-11-30", "03:00"))];
    const now = at("2026-12-01", "12:00");
    expect(hrs(weekTotals(segs, now, TZ, at("2026-11-25", "12:00")).ms.drive)).toBe(3);
    expect(hrs(weekTotals(segs, now, TZ, at("2026-12-01", "12:00")).ms.drive)).toBe(3);
  });

  it("counts real elapsed time across daylight-saving changes", () => {
    // Fall back (Nov 1, 2026): midnight to 6 AM is 7 hours.
    const fall = dailyTotals([seg("work", "job", at("2026-11-01", "00:00"), at("2026-11-01", "06:00"))], at("2026-11-02", "00:00"), TZ, 0, Infinity);
    expect(hrs(fall[0].ms.job)).toBe(7);
    // Spring forward (Mar 8, 2026): midnight to 6 AM is 5 hours.
    const spring = dailyTotals([seg("work", "job", at("2026-03-08", "00:00"), at("2026-03-08", "06:00"))], at("2026-03-09", "00:00"), TZ, 0, Infinity);
    expect(hrs(spring[0].ms.job)).toBe(5);
  });

  it("lunch: 30 minutes or more unpaid; under 30 paid and flagged", () => {
    const d = "2026-11-23";
    const segs = [
      seg("work", "job", at(d, "06:00"), at(d, "11:30")),
      seg("lunch", "job", at(d, "11:30"), at(d, "12:00")), // 30 min: unpaid
      seg("work", "job", at(d, "12:00"), at(d, "15:00")),
      seg("lunch", "job", at(d, "15:00"), at(d, "15:20")), // 20 min: paid, flagged
      seg("work", "drive", at(d, "15:20"), at(d, "16:00")),
    ];
    const [day] = dailyTotals(segs, at(d, "20:00"), TZ, 0, Infinity);
    expect(toHours(day.ms.job)).toBeCloseTo(5.5 + 3 + 1 / 3, 9);
    expect(hrs(day.ms.unpaidLunch)).toBe(0.5);
    expect(day.flags.map((f) => f.flag)).toEqual(["short_lunch"]);
  });

  it("flags a lunch not ended and a missing clock-out; running time counts to now", () => {
    const start = at("2026-11-23", "06:00");
    expect(segmentFlags(seg("lunch", "job", start, null), start + 10 * 60_000)).toEqual(["open_lunch"]);
    expect(segmentFlags(seg("work", "job", start, null), start + 15 * 3_600_000)).toEqual([]);
    expect(segmentFlags(seg("work", "job", start, null), start + 17 * 3_600_000)).toEqual(["missing_clock_out"]);
    const [day] = dailyTotals([seg("work", "ride", start, null)], start + 90 * 60_000, TZ, 0, Infinity);
    expect(hrs(day.ms.ride)).toBe(1.5);
  });
});
