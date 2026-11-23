import { describe, expect, it } from "vitest";
import { buildIcs, escapeText, foldLine, type FeedEvent } from "./ics";

const labels = { calendarName: "Petra jobs", holiday: (n: string) => `Holiday: ${n}`, start: (t: string) => `start ${t}`, openInApp: "Open in the app" };
const job: FeedEvent = {
  kind: "job",
  day: "2026-11-30",
  title: "Day 1 (Monday)",
  startText: "5am",
  projectId: "11111111-1111-4111-8111-111111111111",
  projectName: "Xbow RIB 3",
  address: "201 Business Pk Blvd, Luling, TX 78648",
  jobNumber: "2611",
};

describe("calendar feed", () => {
  it("writes all-day job and holiday events that calendar apps accept", () => {
    const ics = buildIcs([{ kind: "holiday", day: "2026-11-26", title: "Thanksgiving", startText: null, projectId: null, projectName: null, address: null, jobNumber: null }, job], {
      labels,
      origin: "https://petra-field-ops.vercel.app",
      now: new Date("2026-11-23T12:00:00Z"),
      feedId: "abc",
    });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    const raw = ics;
    const unfolded = ics.replace(/\r\n /g, "");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(unfolded).toContain("SUMMARY:Holiday: Thanksgiving");
    expect(unfolded).toContain("DTSTART;VALUE=DATE:20261126\r\nDTEND;VALUE=DATE:20261127");
    expect(unfolded).toContain("SUMMARY:Xbow RIB 3 · Day 1 (Monday) · start 5am");
    expect(unfolded).toContain("LOCATION:201 Business Pk Blvd\\, Luling\\, TX 78648");
    expect(unfolded).toContain("URL:https://petra-field-ops.vercel.app/jobs/11111111-1111-4111-8111-111111111111");
    expect(unfolded).toContain("UID:job-11111111-1111-4111-8111-111111111111-2026-11-30@petra-field-ops.abc");
    expect(unfolded).toContain("DTSTAMP:20261123T120000Z");
    // Every line within 75 octets.
    for (const line of raw.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });

  it("escapes text and folds long lines without splitting characters", () => {
    expect(escapeText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const long = `SUMMARY:${"Piso epóxico ".repeat(10)}`;
    const folded = foldLine(long);
    expect(folded.split("\r\n ").join("")).toBe(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
  });

  it("gives two events on the same job and day different ids", () => {
    const ics = buildIcs([job, { ...job, title: "Day 1 night shift" }], { labels, origin: "https://x", now: new Date(), feedId: "f" });
    expect(ics).toContain("2026-11-30@petra-field-ops.f");
    expect(ics).toContain("2026-11-30-2@petra-field-ops.f");
  });
});
