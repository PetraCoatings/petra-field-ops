import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildIcs, type FeedEvent } from "@/domain/calendar/ics";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A person's private calendar link, fetched by Apple Calendar, Outlook or
 * Google Calendar (which can't sign in). The link's secret is hashed and
 * looked up by public.calendar_feed(), callable only with the server's secret
 * key; an unknown or replaced link gets "not found".
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/calendar-feed/[token]">) {
  const { token: raw } = await ctx.params;
  const token = raw.replace(/\.ics$/i, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return new NextResponse("Not found", { status: 404 });
  if (!process.env.SUPABASE_SECRET_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) return new NextResponse("Not configured", { status: 503 });
  const hash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await createAdminClient().rpc("calendar_feed", { p_token_hash: hash });
  if (error) return new NextResponse("Unavailable", { status: 503 });
  const rows = (data ?? []) as {
    employee_name: string;
    kind: "job" | "holiday" | "time_off";
    day: string;
    title: string | null;
    start_text: string | null;
    project_id: string | null;
    project_name: string | null;
    address: string | null;
    job_number: string | null;
  }[];
  if (rows.length === 0) {
    // Either an unknown link, or a valid one with nothing scheduled: tell them apart.
    const { count } = await createAdminClient().from("calendar_feeds").select("employee_id", { count: "exact", head: true }).eq("token_hash", hash);
    if (!count) return new NextResponse("Not found", { status: 404 });
  }
  const events: FeedEvent[] = rows.map((r) => ({
    kind: r.kind,
    day: r.day,
    title: r.title,
    startText: r.start_text,
    projectId: r.project_id,
    projectName: r.project_name,
    address: r.address,
    jobNumber: r.job_number,
  }));
  const ics = buildIcs(events, {
    labels: {
      calendarName: "Petra Field Ops",
      holiday: (n) => `Holiday: ${n}`,
      timeOff: (w) => `Time off: ${w}`,
      start: (t) => `start ${t}`,
      openInApp: "Open in Petra Field Ops",
    },
    origin: request.nextUrl.origin,
    now: new Date(),
    feedId: hash.slice(0, 12),
  });
  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="petra-field-ops.ics"',
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
