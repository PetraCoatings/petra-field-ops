import "server-only";
import { createClient } from "@/lib/supabase/server";

export type ReportSummary = { id: string; date: string; status: "draft" | "submitted" | "correction_requested" | "accepted" };

export async function recentReports(projectId: string, limit = 14): Promise<ReportSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("daily_field_reports").select("id, report_date, status").eq("project_id", projectId).order("report_date", { ascending: false }).limit(limit);
  return (data ?? []).map((r) => ({ id: r.id as string, date: r.report_date as string, status: r.status as ReportSummary["status"] }));
}

/** May this person write the job's daily report? (Mirrors app.can_write_dfr; the database decides.) */
export function canWriteReport(profile: { employeeId: string; role: string }, job: { crew_lead_id: string | null; project_assignments: { employee_id: string }[] }): boolean {
  if (profile.role === "office_admin" || profile.role === "project_manager") return true;
  return profile.role === "crew_lead" && (job.crew_lead_id === profile.employeeId || job.project_assignments.some((a) => a.employee_id === profile.employeeId));
}
