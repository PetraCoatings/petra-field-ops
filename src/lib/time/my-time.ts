import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_WORKWEEK, workweekStart, type Workweek } from "@/domain/time/zoned";
import type { Segment, TimeCategory } from "@/domain/time/totals";

export type ClockSettings = { timezone: string; workweek: Workweek; gpsOnSwitch: boolean };
export type ClockSegment = Segment & { projectName: string | null };
export type ClockJob = { id: string; name: string; jobNumber: string | null };

export async function clockSettings(): Promise<ClockSettings> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("company_timezone, workweek_start_dow, workweek_start_time, gps_on_category_switch").single();
  return {
    timezone: (data?.company_timezone as string) || "America/Chicago",
    workweek: data
      ? { startDow: Number(data.workweek_start_dow), startTime: String(data.workweek_start_time).slice(0, 5) }
      : DEFAULT_WORKWEEK,
    gpsOnSwitch: Boolean(data?.gps_on_category_switch),
  };
}

/**
 * This person's segments for the current workweek, plus anything still open
 * from before it (a forgotten clock-out).
 */
export async function mySegments(employeeId: string, settings: ClockSettings, now = Date.now()): Promise<ClockSegment[]> {
  const supabase = await createClient();
  const from = new Date(workweekStart(now, settings.timezone, settings.workweek) - 24 * 3_600_000).toISOString();
  const { data } = await supabase
    .from("time_segments")
    .select("id, kind, category, project_id, start_at, end_at, projects(name)")
    .eq("employee_id", employeeId)
    .eq("status", "active")
    .or(`end_at.is.null,end_at.gte.${from}`)
    .order("start_at");
  return ((data ?? []) as unknown as {
    id: string;
    kind: "work" | "lunch";
    category: TimeCategory | null;
    project_id: string | null;
    start_at: string;
    end_at: string | null;
    projects: { name: string } | null;
  }[]).map((r) => ({
    id: r.id,
    kind: r.kind,
    category: r.category,
    projectId: r.project_id,
    projectName: r.projects?.name ?? null,
    start: Date.parse(r.start_at),
    end: r.end_at ? Date.parse(r.end_at) : null,
  }));
}

/** Jobs to clock in to: open jobs this person can see (crews don't see drafts). */
export async function clockJobs(isOffice: boolean): Promise<ClockJob[]> {
  const supabase = await createClient();
  let query = supabase.from("projects").select("id, name, job_number, status").in("status", ["scheduled", "in_progress", "draft"]).order("name");
  if (!isOffice) query = query.neq("status", "draft");
  const { data } = await query;
  return (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, jobNumber: (p.job_number as string | null) ?? null }));
}

/** The server's clock, for the first render (the phone takes over after). */
export const serverNow = () => Date.now();
