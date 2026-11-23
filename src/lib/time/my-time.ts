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

export type CrewPerson = { id: string; name: string; role: string };
export type CrewStatus = { employeeId: string; kind: "work" | "lunch"; category: TimeCategory | null; projectId: string | null; start: number };

/** Everyone active (names only), who's on which job, and who is on the clock now. For crew leads and the office. */
export async function crewData(): Promise<{ people: CrewPerson[]; crews: Record<string, string[]>; status: CrewStatus[] }> {
  const supabase = await createClient();
  const [{ data: people }, { data: assignments }, { data: leads }] = await Promise.all([
    supabase.from("employee_directory").select("id, display_name, role").eq("is_active", true).order("first_name"),
    supabase.from("project_assignments").select("project_id, employee_id"),
    supabase.from("projects").select("id, crew_lead_id").not("crew_lead_id", "is", null),
  ]);
  const crews: Record<string, string[]> = {};
  const addTo = (project: string, emp: string) => {
    const list = (crews[project] ??= []);
    if (!list.includes(emp)) list.push(emp);
  };
  for (const l of leads ?? []) addTo(l.id as string, l.crew_lead_id as string);
  for (const a of assignments ?? []) addTo(a.project_id as string, a.employee_id as string);
  const list = (people ?? []).map((p) => ({ id: p.id as string, name: p.display_name as string, role: p.role as string }));
  const { data: status } = list.length
    ? await supabase.rpc("crew_clock_status", { p_employee_ids: list.slice(0, 100).map((p) => p.id) })
    : { data: [] };
  return {
    people: list,
    crews,
    status: ((status ?? []) as { employee_id: string; kind: "work" | "lunch"; category: TimeCategory | null; project_id: string | null; start_at: string }[]).map((s) => ({
      employeeId: s.employee_id,
      kind: s.kind,
      category: s.category,
      projectId: s.project_id,
      start: Date.parse(s.start_at),
    })),
  };
}
