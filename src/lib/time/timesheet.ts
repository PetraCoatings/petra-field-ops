import "server-only";
import { createClient } from "@/lib/supabase/server";
import { nextWorkweekStart, workweekStart, zonedTimeToInstant } from "@/domain/time/zoned";
import type { TimeCategory } from "@/domain/time/totals";
import type { ClockSettings } from "./my-time";

export type SheetSegment = {
  id: string;
  kind: "work" | "lunch";
  category: TimeCategory | null;
  projectId: string | null;
  projectName: string | null;
  start: number;
  end: number | null;
  status: "active" | "superseded" | "void";
  source: "events" | "correction";
  supersedesId: string | null;
  reason: string | null;
  correctedBy: string | null;
  createdAt: number;
};
export type SheetStatus = {
  status: "open" | "submitted" | "approved";
  submittedBy: string | null;
  submittedAt: number | null;
  approvedBy: string | null;
  approvedAt: number | null;
  reopenedBy: string | null;
  reopenedAt: number | null;
  reopenReason: string | null;
};
export type SheetRequest = { id: string; message: string; segmentId: string | null; status: "open" | "resolved"; createdAt: number; resolvedBy: string | null; note: string | null };
export type Sheet = {
  employeeId: string;
  employeeName: string;
  weekStart: number;
  weekEnd: number;
  segments: SheetSegment[];
  status: SheetStatus;
  requests: SheetRequest[];
  names: Record<string, string>;
};

/** "2026-11-23" → an instant inside that day (noon), company time zone; anything else → now. */
export function weekParam(raw: string | string[] | undefined, tz: string): number {
  const m = typeof raw === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw) : null;
  return m ? zonedTimeToInstant(Number(m[1]), Number(m[2]), Number(m[3]), 12, 0, tz) : Date.now();
}

const ms = (v: string | null) => (v ? Date.parse(v) : null);

/** One person's week: every segment (with replaced and removed ones, for history), the week's status and requests. */
export async function loadSheet(employeeId: string, weekOf: number, settings: ClockSettings): Promise<Sheet | null> {
  const supabase = await createClient();
  const weekStart = workweekStart(weekOf, settings.timezone, settings.workweek);
  const weekEnd = nextWorkweekStart(weekStart, settings.timezone, settings.workweek);
  const [{ data: person }, { data: segs }, { data: sheet }, { data: reqs }] = await Promise.all([
    supabase.from("employee_directory").select("id, display_name").eq("id", employeeId).maybeSingle(),
    supabase
      .from("time_segments")
      .select("id, kind, category, project_id, start_at, end_at, status, source, supersedes_id, correction_reason, corrected_by, created_at, projects(name)")
      .eq("employee_id", employeeId)
      .lt("start_at", new Date(weekEnd).toISOString())
      .or(`end_at.is.null,end_at.gte.${new Date(weekStart).toISOString()}`)
      .order("start_at"),
    supabase.from("timesheets").select("*").eq("employee_id", employeeId).eq("week_start", new Date(weekStart).toISOString()).maybeSingle(),
    supabase
      .from("time_change_requests")
      .select("id, message, segment_id, status, created_at, resolved_by, resolution_note")
      .eq("employee_id", employeeId)
      .eq("week_start", new Date(weekStart).toISOString())
      .order("created_at"),
  ]);
  if (!person) return null;
  const segments: SheetSegment[] = ((segs ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as "work" | "lunch",
    category: (r.category as TimeCategory | null) ?? null,
    projectId: (r.project_id as string | null) ?? null,
    projectName: (r.projects as { name: string } | null)?.name ?? null,
    start: Date.parse(r.start_at as string),
    end: ms(r.end_at as string | null),
    status: r.status as SheetSegment["status"],
    source: r.source as SheetSegment["source"],
    supersedesId: (r.supersedes_id as string | null) ?? null,
    reason: (r.correction_reason as string | null) ?? null,
    correctedBy: (r.corrected_by as string | null) ?? null,
    createdAt: Date.parse(r.created_at as string),
  }));
  const status: SheetStatus = {
    status: ((sheet?.status as SheetStatus["status"]) ?? "open"),
    submittedBy: (sheet?.submitted_by as string | null) ?? null,
    submittedAt: ms((sheet?.submitted_at as string | null) ?? null),
    approvedBy: (sheet?.approved_by as string | null) ?? null,
    approvedAt: ms((sheet?.approved_at as string | null) ?? null),
    reopenedBy: (sheet?.reopened_by as string | null) ?? null,
    reopenedAt: ms((sheet?.reopened_at as string | null) ?? null),
    reopenReason: (sheet?.reopen_reason as string | null) ?? null,
  };
  const requests: SheetRequest[] = (reqs ?? []).map((r) => ({
    id: r.id as string,
    message: r.message as string,
    segmentId: (r.segment_id as string | null) ?? null,
    status: r.status as "open" | "resolved",
    createdAt: Date.parse(r.created_at as string),
    resolvedBy: (r.resolved_by as string | null) ?? null,
    note: (r.resolution_note as string | null) ?? null,
  }));
  const ids = new Set<string>([
    ...segments.map((s) => s.correctedBy),
    status.submittedBy,
    status.approvedBy,
    status.reopenedBy,
    ...requests.map((r) => r.resolvedBy),
  ].filter((x): x is string => Boolean(x)));
  const { data: dir } = ids.size ? await supabase.from("employee_directory").select("id, display_name").in("id", [...ids]) : { data: [] };
  const names = Object.fromEntries((dir ?? []).map((d) => [d.id as string, d.display_name as string]));
  return { employeeId, employeeName: person.display_name as string, weekStart, weekEnd, segments, status, requests, names };
}

/** Company self-edit window, in hours (24 by default). */
export async function selfEditWindowHours(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("self_edit_window_hours").single();
  const n = Number(data?.self_edit_window_hours);
  return Number.isFinite(n) ? n : 24;
}

export type WeekRow = {
  employeeId: string;
  name: string;
  segments: { kind: "work" | "lunch"; category: TimeCategory | null; start: number; end: number | null; id: string; projectId: string | null }[];
  status: SheetStatus["status"];
  openRequests: number;
};

/** Everyone whose time this viewer can see for the week (RLS decides: a lead's crew, or everyone for office admins). */
export async function loadWeekRows(weekOf: number, settings: ClockSettings, include: string[] = []): Promise<{ weekStart: number; weekEnd: number; rows: WeekRow[] }> {
  const supabase = await createClient();
  const weekStart = workweekStart(weekOf, settings.timezone, settings.workweek);
  const weekEnd = nextWorkweekStart(weekStart, settings.timezone, settings.workweek);
  const iso = (n: number) => new Date(n).toISOString();
  const [{ data: segs }, { data: sheets }, { data: reqs }] = await Promise.all([
    supabase
      .from("time_segments")
      .select("id, employee_id, kind, category, project_id, start_at, end_at")
      .eq("status", "active")
      .lt("start_at", iso(weekEnd))
      .or(`end_at.is.null,end_at.gte.${iso(weekStart)}`),
    supabase.from("timesheets").select("employee_id, status").eq("week_start", iso(weekStart)),
    supabase.from("time_change_requests").select("employee_id").eq("status", "open").eq("week_start", iso(weekStart)),
  ]);
  const ids = new Set<string>([...include, ...(segs ?? []).map((s) => s.employee_id as string), ...(reqs ?? []).map((r) => r.employee_id as string)]);
  const { data: dir } = ids.size ? await supabase.from("employee_directory").select("id, display_name").in("id", [...ids]) : { data: [] };
  const rows: WeekRow[] = (dir ?? [])
    .map((d) => ({
      employeeId: d.id as string,
      name: d.display_name as string,
      segments: (segs ?? [])
        .filter((s) => s.employee_id === d.id)
        .map((s) => ({
          id: s.id as string,
          kind: s.kind as "work" | "lunch",
          category: (s.category as TimeCategory | null) ?? null,
          projectId: (s.project_id as string | null) ?? null,
          start: Date.parse(s.start_at as string),
          end: s.end_at ? Date.parse(s.end_at as string) : null,
        })),
      status: ((sheets ?? []).find((t) => t.employee_id === d.id)?.status as SheetStatus["status"]) ?? "open",
      openRequests: (reqs ?? []).filter((r) => r.employee_id === d.id).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { weekStart, weekEnd, rows };
}
