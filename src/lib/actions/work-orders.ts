"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkContent, isEmptyContent, newWorkOrderContent } from "@/domain/work-orders/content";
import { requireProfile, requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * Field work order server actions. Row Level Security and publish_fwo() are
 * the real gatekeepers; these add role checks for clear errors and validate
 * the content before it is stored.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function revalidateWorkOrder(projectId: string, fwoId: string) {
  revalidatePath(`/manage/projects/${projectId}`);
  revalidatePath(`/manage/projects/${projectId}/work-orders/${fwoId}`);
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath(`/jobs/${projectId}/work-orders/${fwoId}`);
}

/** Form action on the project page: create a work order and open the editor. */
export async function createWorkOrder(projectId: string, formData: FormData): Promise<void> {
  await requireRole("project_manager", "office_admin");
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  if (!isId(projectId) || !title) return;
  const supabase = await createClient();
  const { data, error } = await supabase.from("field_work_orders").insert({ project_id: projectId, title }).select("id").single();
  if (error || !data) return;
  await supabase.from("fwo_drafts").insert({ fwo_id: data.id, content: newWorkOrderContent() });
  revalidatePath(`/manage/projects/${projectId}`);
  redirect(`/manage/projects/${projectId}/work-orders/${data.id}`);
}

export type SaveDraftResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: "invalid" | "title" | "generic"; issues?: { path: string; message: string }[] };

async function writeDraft(fwoId: string, title: string, rawContent: unknown) {
  const supabase = await createClient();
  const { data: fwo } = await supabase.from("field_work_orders").select("id, project_id, status").eq("id", fwoId).maybeSingle();
  if (!fwo) return { result: { ok: false, error: "generic" } as SaveDraftResult };
  const cleanTitle = title.trim().slice(0, 200);
  if (!cleanTitle) return { result: { ok: false, error: "title" } as SaveDraftResult };
  const checked = checkContent(rawContent, { projectId: fwo.project_id as string, fwoId });
  if (!checked.ok) return { result: { ok: false, error: "invalid", issues: checked.issues } as SaveDraftResult };

  const now = new Date().toISOString();
  const [{ error: e1 }, { error: e2 }] = await Promise.all([
    supabase.from("fwo_drafts").upsert({ fwo_id: fwoId, content: checked.content }),
    supabase.from("field_work_orders").update({ title: cleanTitle }).eq("id", fwoId),
  ]);
  if (e1 || e2) return { result: { ok: false, error: "generic" } as SaveDraftResult };
  return { result: { ok: true, savedAt: now } as SaveDraftResult, projectId: fwo.project_id as string, content: checked.content };
}

export async function saveWorkOrderDraft(fwoId: string, draft: { title: string; content: unknown }): Promise<SaveDraftResult> {
  await requireRole("project_manager", "office_admin");
  if (!isId(fwoId)) return { ok: false, error: "generic" };
  const { result, projectId } = await writeDraft(fwoId, String(draft?.title ?? ""), draft?.content);
  if (result.ok && projectId) revalidateWorkOrder(projectId, fwoId);
  return result;
}

export type PublishResult =
  | { ok: true; revision: number }
  | { ok: false; error: "invalid" | "title" | "empty" | "summary" | "void" | "generic"; issues?: { path: string; message: string }[] };

/** Saves the editor's content, then publishes it as the next revision. */
export async function publishWorkOrder(
  fwoId: string,
  draft: { title: string; content: unknown; changeSummary?: string },
): Promise<PublishResult> {
  await requireRole("project_manager", "office_admin");
  if (!isId(fwoId)) return { ok: false, error: "generic" };
  const saved = await writeDraft(fwoId, String(draft?.title ?? ""), draft?.content);
  if (!saved.result.ok) return saved.result;
  if (saved.content && isEmptyContent(saved.content)) return { ok: false, error: "empty" };

  const supabase = await createClient();
  const summary = typeof draft.changeSummary === "string" ? draft.changeSummary.trim().slice(0, 1000) : "";
  const { data: revId, error } = await supabase.rpc("publish_fwo", { p_fwo_id: fwoId, p_change_summary: summary || null });
  if (error) {
    const msg = error.message ?? "";
    if (/Describe what changed/.test(msg)) return { ok: false, error: "summary" };
    if (/empty/.test(msg)) return { ok: false, error: "empty" };
    if (/voided/.test(msg)) return { ok: false, error: "void" };
    return { ok: false, error: "generic" };
  }
  const { data: rev } = await supabase.from("fwo_revisions").select("revision_number").eq("id", revId as string).single();
  revalidateWorkOrder(saved.projectId!, fwoId);
  revalidatePath("/notifications");
  return { ok: true, revision: (rev?.revision_number as number) ?? 0 };
}

/** Form action for crews: "I've read this revision". */
export async function acknowledgeRevision(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  const revisionId = formData.get("revisionId");
  const projectId = formData.get("projectId");
  const fwoId = formData.get("fwoId");
  if (!isId(revisionId) || !isId(projectId) || !isId(fwoId)) return;
  if (profile.role !== "installer" && profile.role !== "crew_lead") return;
  const supabase = await createClient();
  // A repeat tap is harmless: the unique constraint keeps one acknowledgment.
  await supabase.from("fwo_acknowledgments").insert({ fwo_revision_id: revisionId });
  // The notification about this work order has done its job.
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("entity_id", fwoId)
    .is("read_at", null);
  revalidateWorkOrder(projectId, fwoId);
  revalidatePath("/notifications");
  revalidatePath("/", "layout");
}

/** Opens a notification: marks it read, then goes to what it's about. */
export async function openNotification(formData: FormData): Promise<void> {
  await requireProfile();
  const id = formData.get("id");
  if (!isId(id)) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select("type, project_id, entity_id")
    .maybeSingle();
  revalidatePath("/", "layout");
  if (data?.type === "fwo_published" && data.project_id && data.entity_id) {
    redirect(`/jobs/${data.project_id}#wo-${data.entity_id}`);
  }
  redirect("/notifications");
}

export async function markAllNotificationsRead(): Promise<void> {
  await requireProfile();
  const supabase = await createClient();
  await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  revalidatePath("/", "layout");
}
