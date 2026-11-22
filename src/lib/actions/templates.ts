"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newWorkOrderContent, readContent } from "@/domain/work-orders/content";
import { checkTemplateContent, toTemplateContent } from "@/domain/work-orders/templates";
import { requireRole } from "@/lib/auth/dal";
import { type FormState } from "@/lib/forms/form-state";
import { createClient } from "@/lib/supabase/server";

/** Work order template actions (project managers and office admins; RLS enforces it too). */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);
const cleanName = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 120) : "");

/** Form action on the Templates page. A blank template starts with nothing filled in. */
export async function createTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireRole("project_manager", "office_admin");
  const name = cleanName(formData.get("name"));
  if (!name) return { status: "error", fieldErrors: { name: "validation.required" } };
  const supabase = await createClient();
  const empty = { ...newWorkOrderContent(), summary: [], schedule: [] };
  const { data, error } = await supabase.from("work_order_templates").insert({ name, content: empty }).select("id").single();
  if (error) return error.code === "23505" ? { status: "error", fieldErrors: { name: "templates.nameTaken" } } : { status: "error", message: "common.genericError" };
  revalidatePath("/manage/templates");
  redirect(`/manage/templates/${data.id}`);
}

export type TemplateSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: "invalid" | "name" | "nameTaken" | "generic"; issues?: { path: string; message: string }[] };

export async function saveTemplate(id: string, input: { name: string; description: string; content: unknown }): Promise<TemplateSaveResult> {
  const profile = await requireRole("project_manager", "office_admin");
  if (!isId(id)) return { ok: false, error: "generic" };
  const name = cleanName(input?.name);
  if (!name) return { ok: false, error: "name" };
  const checked = checkTemplateContent(input?.content);
  if (!checked.ok) return { ok: false, error: "invalid", issues: checked.issues };
  const description = typeof input.description === "string" ? input.description.trim().slice(0, 500) : "";
  const supabase = await createClient();
  const { error } = await supabase
    .from("work_order_templates")
    .update({ name, description: description || null, content: checked.content, updated_by: profile.employeeId })
    .eq("id", id);
  if (error) return { ok: false, error: error.code === "23505" ? "nameTaken" : "generic" };
  revalidatePath("/manage/templates");
  revalidatePath(`/manage/templates/${id}`);
  return { ok: true, id };
}

/** "Save as template" from the work order editor: copies the editor's content, minus dates and drawings. */
export async function saveWorkOrderAsTemplate(input: { name: string; content: unknown }): Promise<TemplateSaveResult> {
  await requireRole("project_manager", "office_admin");
  const name = cleanName(input?.name);
  if (!name) return { ok: false, error: "name" };
  const content = toTemplateContent(readContent(input?.content));
  const checked = checkTemplateContent(content);
  if (!checked.ok) return { ok: false, error: "invalid", issues: checked.issues };
  const supabase = await createClient();
  const { data, error } = await supabase.from("work_order_templates").insert({ name, content: checked.content }).select("id").single();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "nameTaken" : "generic" };
  revalidatePath("/manage/templates");
  return { ok: true, id: data.id as string };
}

/** Archive (hide from the "Insert template" list) or restore. */
export async function setTemplateActive(id: string, active: boolean): Promise<void> {
  await requireRole("project_manager", "office_admin");
  if (!isId(id)) return;
  const supabase = await createClient();
  await supabase.from("work_order_templates").update({ is_active: active }).eq("id", id);
  revalidatePath("/manage/templates");
  revalidatePath(`/manage/templates/${id}`);
}

/** Deleting a template never affects work orders: they hold their own copies. */
export async function deleteTemplate(id: string): Promise<void> {
  await requireRole("project_manager", "office_admin");
  if (!isId(id)) return;
  const supabase = await createClient();
  await supabase.from("work_order_templates").delete().eq("id", id);
  revalidatePath("/manage/templates");
  redirect("/manage/templates");
}
