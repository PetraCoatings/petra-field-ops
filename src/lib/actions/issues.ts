"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { ISSUE_TYPES } from "@/domain/reports/field";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export async function reportIssue(payload: { projectId: string; type: string; description: string; urgent: boolean }): Promise<{ ok: true; id: string } | { ok: false; error: "description" | "generic" }> {
  await requireProfile();
  const parsed = z
    .object({ projectId: uuid, type: z.enum(ISSUE_TYPES), description: z.string().trim().min(3).max(2000), urgent: z.boolean() })
    .safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.path[0] === "description" ? "description" : "generic" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_issue", {
    p_project_id: parsed.data.projectId,
    p_type: parsed.data.type,
    p_description: parsed.data.description,
    p_requires_attention: parsed.data.urgent,
  });
  if (error) return { ok: false, error: "generic" };
  revalidatePath(`/jobs/${parsed.data.projectId}`, "layout");
  return { ok: true, id: data as string };
}

export async function resolveIssue(fd: FormData): Promise<void> {
  await requireProfile();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.rpc("resolve_issue", { p_issue_id: id.data, p_note: String(fd.get("note") ?? "") });
  revalidatePath("/jobs", "layout");
  revalidatePath("/manage/projects", "layout");
}
