import "server-only";
import { directoryNames } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import type { ProjectSnapshot } from "./snapshot";

export type FwoRow = {
  id: string;
  project_id: string;
  fwo_number: number;
  title: string;
  status: "draft" | "published" | "void";
  current_revision_id: string | null;
};

export type RevisionRow = {
  id: string;
  revision_number: number;
  content: unknown;
  project_snapshot: ProjectSnapshot;
  change_summary: string | null;
  published_by: string | null;
  published_at: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A work order on a given project, or null (not found, wrong project, or not visible to this user). */
export async function loadFwo(projectId: string, fwoId: string): Promise<FwoRow | null> {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(fwoId)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("field_work_orders")
    .select("id, project_id, fwo_number, title, status, current_revision_id")
    .eq("id", fwoId)
    .eq("project_id", projectId)
    .maybeSingle();
  return (data as FwoRow | null) ?? null;
}

export async function loadRevisions(fwoId: string): Promise<RevisionRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("fwo_revisions")
    .select("id, revision_number, content, project_snapshot, change_summary, published_by, published_at")
    .eq("fwo_id", fwoId)
    .order("revision_number", { ascending: false });
  return (data ?? []) as RevisionRow[];
}

/** The project's details as they are right now (for previewing a draft). */
export async function liveProjectSnapshot(projectId: string): Promise<ProjectSnapshot> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("projects")
    .select("name, job_number, site_street, site_city, site_state, site_postal_code, scheduled_start, total_sqft, flooring_system, project_manager_id, crew_lead_id, customers(name), project_contacts(name, title, phone, is_primary)")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) return {};
  const p = data as unknown as {
    name: string;
    job_number: string | null;
    site_street: string | null;
    site_city: string | null;
    site_state: string | null;
    site_postal_code: string | null;
    scheduled_start: string | null;
    total_sqft: string | null;
    flooring_system: string | null;
    project_manager_id: string | null;
    crew_lead_id: string | null;
    customers: { name: string } | null;
    project_contacts: { name: string; title: string | null; phone: string | null; is_primary: boolean }[];
  };
  const names = await directoryNames([p.project_manager_id, p.crew_lead_id]);
  return {
    name: p.name,
    jobNumber: p.job_number,
    customer: p.customers?.name ?? null,
    street: p.site_street,
    city: p.site_city,
    state: p.site_state,
    postalCode: p.site_postal_code,
    scheduledStart: p.scheduled_start,
    totalSqft: p.total_sqft,
    flooringSystem: p.flooring_system,
    projectManager: p.project_manager_id ? names.get(p.project_manager_id)?.display_name : null,
    crewLead: p.crew_lead_id ? names.get(p.crew_lead_id)?.display_name : null,
    contacts: [...p.project_contacts]
      .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
      .map(({ name, title, phone }) => ({ name, title, phone })),
  };
}

/** Everyone who should acknowledge: assigned crew plus the project's crew lead. */
export async function crewIds(projectId: string): Promise<string[]> {
  const supabase = await createClient();
  const [{ data: assigned }, { data: project }] = await Promise.all([
    supabase.from("project_assignments").select("employee_id").eq("project_id", projectId),
    supabase.from("projects").select("crew_lead_id").eq("id", projectId).maybeSingle(),
  ]);
  const ids = new Set((assigned ?? []).map((a) => a.employee_id as string));
  if (project?.crew_lead_id) ids.add(project.crew_lead_id as string);
  return [...ids];
}
