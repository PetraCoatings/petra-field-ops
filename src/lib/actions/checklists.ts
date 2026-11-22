"use server";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Loading checklist actions. The database functions check that the caller is
 * the job's crew lead or office staff; these only validate input.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
type Result = { ok: true } | { ok: false; error: "forbidden" | "generic" };

function refresh(projectId: string, fwoId: string) {
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath(`/jobs/${projectId}/checklist/${fwoId}`);
  revalidatePath(`/manage/projects/${projectId}/work-orders/${fwoId}`);
}

function fail(error: { code?: string } | null): Result {
  return { ok: false, error: error?.code === "42501" ? "forbidden" : "generic" };
}

export async function setChecklistItem(
  where: { projectId: string; fwoId: string },
  itemId: string,
  status: "pending" | "loaded" | "missing",
  note?: string,
): Promise<Result> {
  await requireProfile();
  if (!isId(itemId) || !isId(where?.projectId) || !isId(where?.fwoId) || !["pending", "loaded", "missing"].includes(status)) {
    return { ok: false, error: "generic" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_checklist_item", {
    p_item_id: itemId,
    p_status: status,
    p_note: typeof note === "string" ? note.slice(0, 500) : null,
  });
  if (error) return fail(error);
  refresh(where.projectId, where.fwoId);
  return { ok: true };
}

export async function addChecklistItem(
  where: { projectId: string; fwoId: string },
  checklistId: string,
  item: string,
  qty: string,
): Promise<Result> {
  await requireProfile();
  const text = typeof item === "string" ? item.trim().slice(0, 200) : "";
  if (!text || !isId(checklistId) || !isId(where?.projectId) || !isId(where?.fwoId)) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_checklist_item", {
    p_checklist_id: checklistId,
    p_item: text,
    p_qty: typeof qty === "string" ? qty.trim().slice(0, 80) : null,
  });
  if (error) return fail(error);
  refresh(where.projectId, where.fwoId);
  return { ok: true };
}

export async function syncChecklist(where: { projectId: string; fwoId: string }, checklistId: string): Promise<Result> {
  await requireProfile();
  if (!isId(checklistId) || !isId(where?.projectId) || !isId(where?.fwoId)) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("sync_loading_checklist", { p_checklist_id: checklistId });
  if (error) return fail(error);
  refresh(where.projectId, where.fwoId);
  return { ok: true };
}
