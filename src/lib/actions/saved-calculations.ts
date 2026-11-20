"use server";
import { revalidatePath } from "next/cache";
import { DEFAULT_DEW_POINT_MARGIN_F } from "@/domain/calculators/dew-point";
import { CALC_ENGINE_VERSION, validateAndCompute } from "@/domain/calculators/saved";
import { requireProfile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

/**
 * "Save to job" server actions. Row Level Security decides which projects a
 * person can save to (assigned crew, or any project for PMs and admins); these
 * actions add input validation and recompute every result on the server.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SaveTarget = { id: string; name: string; jobNumber: string | null };

/** Projects this person can save to: open jobs they can see (crews don't see drafts). */
export async function listSaveTargets(): Promise<SaveTarget[]> {
  const profile = await requireProfile();
  const supabase = await createClient();
  let query = supabase.from("projects").select("id, name, job_number, status").neq("status", "closed").order("name");
  if (!canAccessManagement(profile.role)) query = query.neq("status", "draft");
  const { data } = await query;
  return (data ?? []).map((p) => ({ id: p.id as string, name: p.name as string, jobNumber: (p.job_number as string | null) ?? null }));
}

export type SaveResult =
  | { ok: true; projectId: string; projectName: string }
  | { ok: false; error: "invalid" | "forbidden" | "generic" };

export async function saveCalculation(payload: {
  projectId: string;
  type: string;
  inputs: unknown;
  label?: string;
}): Promise<SaveResult> {
  await requireProfile();
  if (typeof payload?.projectId !== "string" || !UUID_RE.test(payload.projectId)) return { ok: false, error: "invalid" };
  const label = typeof payload.label === "string" ? payload.label.trim().slice(0, 120) : "";

  const supabase = await createClient();
  const [{ data: project }, { data: settings }] = await Promise.all([
    supabase.from("projects").select("id, name").eq("id", payload.projectId).maybeSingle(),
    supabase.from("app_settings").select("dew_point_margin_f").single(),
  ]);
  if (!project) return { ok: false, error: "forbidden" }; // not visible to this person
  const margin = Number(settings?.dew_point_margin_f);

  const validated = validateAndCompute(payload.type, payload.inputs, {
    dewPointMarginF: Number.isFinite(margin) && margin >= 0 ? margin : DEFAULT_DEW_POINT_MARGIN_F,
  });
  if (!validated) return { ok: false, error: "invalid" };

  const { error } = await supabase.from("saved_calculations").insert({
    project_id: project.id,
    type: validated.type,
    label: label || null,
    inputs: validated.inputs,
    outputs: validated.outputs,
    engine_version: CALC_ENGINE_VERSION,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "generic" };
  revalidatePath(`/jobs/${project.id}`);
  revalidatePath(`/manage/projects/${project.id}`);
  return { ok: true, projectId: project.id as string, projectName: project.name as string };
}

/** Form action. RLS allows the person who saved it, or a PM / office admin. */
export async function deleteSavedCalculation(formData: FormData): Promise<void> {
  await requireProfile();
  const id = formData.get("id");
  const projectId = formData.get("projectId");
  if (typeof id !== "string" || !UUID_RE.test(id) || typeof projectId !== "string" || !UUID_RE.test(projectId)) return;
  const supabase = await createClient();
  await supabase.from("saved_calculations").delete().eq("id", id);
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath(`/manage/projects/${projectId}`);
}
