"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkProduct, isDocumentPath } from "@/domain/library/product";
import { requireRole } from "@/lib/auth/dal";
import type { FormState } from "@/lib/forms/form-state";
import { createClient } from "@/lib/supabase/server";

/**
 * Product and SDS library actions (project managers and office admins). Row
 * Level Security and database triggers enforce the rules: only office admins
 * approve, and a spec change by anyone else sends the product back to draft.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function refresh(productId?: string) {
  revalidatePath("/manage/library");
  revalidatePath("/manage/library/sds");
  if (productId) revalidatePath(`/manage/library/products/${productId}`);
  revalidatePath("/products");
  revalidatePath("/sds");
}

/** Finds a manufacturer by name (any case), creating it if new. */
async function manufacturerId(name: unknown): Promise<string | null> {
  const clean = typeof name === "string" ? name.trim().slice(0, 120) : "";
  if (!clean) return null;
  const supabase = await createClient();
  const { data: found } = await supabase.from("manufacturers").select("id, name");
  const match = (found ?? []).find((m) => (m.name as string).trim().toLowerCase() === clean.toLowerCase());
  if (match) return match.id as string;
  const { data } = await supabase.from("manufacturers").insert({ name: clean }).select("id").single();
  return (data?.id as string) ?? null;
}

/** Form action: "New product" (name + manufacturer), then open its page. */
export async function createProduct(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("project_manager", "office_admin");
  const name = String(fd.get("name") ?? "").trim().slice(0, 160);
  if (!name) return { status: "error", fieldErrors: { name: "validation.required" } };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .insert({ name, manufacturer_id: await manufacturerId(fd.get("manufacturer")) })
    .select("id")
    .single();
  if (error) return error.code === "23505" ? { status: "error", fieldErrors: { name: "library.errors.duplicate" } } : { status: "error", message: "common.genericError" };
  refresh();
  redirect(`/manage/library/products/${data.id}`);
}

export type SaveProductResult = { ok: true; status: "draft" | "approved" } | { ok: false; errors?: Record<string, string>; message?: string };

export async function saveProduct(id: string, input: Record<string, unknown>): Promise<SaveProductResult> {
  await requireRole("project_manager", "office_admin");
  if (!isId(id)) return { ok: false, message: "common.genericError" };
  const checked = checkProduct(input);
  if (!checked.ok) return { ok: false, errors: checked.errors };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ ...checked.values, manufacturer_id: await manufacturerId(input.manufacturer) })
    .eq("id", id)
    .select("spec_status")
    .single();
  if (error) return error.code === "23505" ? { ok: false, errors: { name: "library.errors.duplicate" } } : { ok: false, message: "common.genericError" };
  refresh(id);
  return { ok: true, status: data.spec_status as "draft" | "approved" };
}

/** Office admins only (the database refuses anyone else). */
export async function setProductApproval(id: string, approved: boolean): Promise<{ ok: boolean }> {
  await requireRole("office_admin");
  if (!isId(id)) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("products").update({ spec_status: approved ? "approved" : "draft" }).eq("id", id);
  refresh(id);
  return { ok: !error };
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  await requireRole("project_manager", "office_admin");
  if (!isId(id)) return;
  const supabase = await createClient();
  await supabase.from("products").update({ is_active: active }).eq("id", id);
  refresh(id);
}

/**
 * The document "slot" to upload into: a product's TDS or SDS (created the
 * first time), or a new standalone SDS with its own name.
 */
export async function ensureDocument(target: { productId: string; docType: "tds" | "sds" } | { standaloneName: string }): Promise<{ ok: true; id: string } | { ok: false }> {
  await requireRole("project_manager", "office_admin");
  const supabase = await createClient();
  if ("productId" in target) {
    if (!isId(target.productId) || (target.docType !== "tds" && target.docType !== "sds")) return { ok: false };
    const { data: existing } = await supabase.from("documents").select("id").eq("product_id", target.productId).eq("doc_type", target.docType).maybeSingle();
    if (existing) return { ok: true, id: existing.id as string };
    const { data, error } = await supabase.from("documents").insert({ product_id: target.productId, doc_type: target.docType }).select("id").single();
    return error || !data ? { ok: false } : { ok: true, id: data.id as string };
  }
  const name = typeof target.standaloneName === "string" ? target.standaloneName.trim().slice(0, 160) : "";
  if (!name) return { ok: false };
  const { data, error } = await supabase.from("documents").insert({ doc_type: "sds", name }).select("id").single();
  return error || !data ? { ok: false } : { ok: true, id: data.id as string };
}

/** Records an uploaded file as the next version of a document. */
export async function recordDocumentVersion(
  documentId: string,
  file: { path: string; fileName: string; size: number; sha256?: string; revisionDate?: string },
): Promise<{ ok: boolean; version?: number }> {
  await requireRole("project_manager", "office_admin");
  if (!isId(documentId) || typeof file?.path !== "string" || !isDocumentPath(file.path, documentId)) return { ok: false };
  const fileName = String(file.fileName ?? "").trim().slice(0, 200) || "document.pdf";
  const size = Number(file.size);
  if (!Number.isInteger(size) || size <= 0 || size > 30 * 1024 * 1024) return { ok: false };
  const sha = typeof file.sha256 === "string" && /^[0-9a-f]{64}$/.test(file.sha256) ? file.sha256 : null;
  const revisionDate = typeof file.revisionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(file.revisionDate) ? file.revisionDate : null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_versions")
    .insert({ document_id: documentId, storage_path: file.path, file_name: fileName, file_size: size, file_sha256: sha, revision_date: revisionDate })
    .select("version, documents(product_id)")
    .single();
  if (error || !data) return { ok: false };
  refresh((data.documents as unknown as { product_id: string | null } | null)?.product_id ?? undefined);
  return { ok: true, version: data.version as number };
}

/** Rename a standalone SDS, or hide/show a document. */
export async function updateDocument(id: string, patch: { name?: string; isActive?: boolean }): Promise<{ ok: boolean }> {
  await requireRole("project_manager", "office_admin");
  if (!isId(id)) return { ok: false };
  const update: Record<string, unknown> = {};
  if (typeof patch.name === "string" && patch.name.trim()) update.name = patch.name.trim().slice(0, 160);
  if (typeof patch.isActive === "boolean") update.is_active = patch.isActive;
  if (Object.keys(update).length === 0) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update(update).eq("id", id);
  refresh();
  return { ok: !error };
}
