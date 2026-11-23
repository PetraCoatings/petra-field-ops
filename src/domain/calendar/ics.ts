/**
 * iCalendar (RFC 5545) feed that Apple Calendar, Outlook and Google Calendar
 * subscribe to. Every event is an all-day event: work order days have a start
 * time typed by the office ("5am") but no end time, so the start goes in the
 * title instead of inventing an end.
 */

export type FeedEvent = {
  kind: "job" | "holiday" | "time_off";
  day: string; // YYYY-MM-DD
  title: string | null;
  startText: string | null;
  projectId: string | null;
  projectName: string | null;
  address: string | null;
  jobNumber: string | null;
};

export type FeedLabels = {
  calendarName: string;
  holiday: (name: string) => string;
  timeOff: (who: string) => string;
  start: (time: string) => string;
  openInApp: string;
};

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Folds a content line to at most 75 octets (RFC 5545 §3.1), never splitting a character. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (size + n > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compact = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => {
  const x = new Date(`${d}T12:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
};

export function buildIcs(events: readonly FeedEvent[], opts: { labels: FeedLabels; origin: string; now: Date; feedId: string }): string {
  const stamp = opts.now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Petra Coatings//Petra Field Operations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(opts.labels.calendarName)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  const seen = new Map<string, number>();
  for (const e of events) {
    const base = e.kind === "holiday" ? `holiday-${e.day}` : e.kind === "time_off" ? `off-${e.day}-${(e.title ?? "").replace(/[^A-Za-z0-9]+/g, "-")}` : `job-${e.projectId}-${e.day}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const summary =
      e.kind === "holiday"
        ? opts.labels.holiday(e.title ?? "")
        : e.kind === "time_off"
          ? opts.labels.timeOff(e.title ?? "") + (e.startText ? ` (${e.startText})` : "")
          : [e.projectName, e.title, e.startText ? opts.labels.start(e.startText) : null].filter(Boolean).join(" · ");
    const url = e.kind === "job" && e.projectId ? `${opts.origin}/jobs/${e.projectId}` : null;
    const description = [e.jobNumber ? `#${e.jobNumber}` : null, e.address, url ? `${opts.labels.openInApp}: ${url}` : null].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${base}${n > 1 ? `-${n}` : ""}@petra-field-ops.${opts.feedId}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.day)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(e.day))}`,
      `SUMMARY:${escapeText(summary)}`,
      "TRANSP:TRANSPARENT",
    );
    if (e.address) lines.push(`LOCATION:${escapeText(e.address)}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    if (url) lines.push(`URL:${url}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
