"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_STAGES } from "@/domain/reports/field";
import { recordPhotoCore, type PhotoRecordInput } from "@/lib/photos/record-core";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** Saves a photo's record after the phone uploaded its files (see lib/photos/record-core.ts). */
export async function recordPhoto(payload: PhotoRecordInput): Promise<{ ok: boolean }> {
  await requireProfile();
  const r = await recordPhotoCore(await createClient(), payload);
  if (r.ok && r.projectId) revalidatePath(`/jobs/${r.projectId}`, "layout");
  return { ok: r.ok };
}

export async function updatePhoto(fd: FormData): Promise<void> {
  await requireProfile();
  const id = uuid.safeParse(fd.get("id"));
  const stage = z.enum(PHOTO_STAGES).safeParse(fd.get("stage"));
  const notes = z.string().trim().max(500).safeParse(fd.get("notes") ?? "");
  if (!id.success || !stage.success || !notes.success) return;
  const supabase = await createClient();
  const { data } = await supabase.from("photos").update({ stage: stage.data, notes: notes.data || null }).eq("id", id.data).select("project_id").maybeSingle();
  if (data) revalidatePath(`/jobs/${data.project_id}`, "layout");
}

/** Remove a photo: the record (permission checked by the database), then its files. */
export async function deletePhoto(fd: FormData): Promise<void> {
  await requireProfile();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  const { data } = await supabase.from("photos").delete().eq("id", id.data).select("project_id, client_id").maybeSingle();
  if (!data) return;
  if (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // The file names are rebuilt from the photo's own job and id (never taken
    // from the stored path), so removing a photo can only ever remove its own files.
    const base = `${data.project_id}/${data.client_id}`;
    await createAdminClient().storage.from("job-photos").remove([`${base}.jpg`, `${base}_thumb.jpg`]);
  }
  revalidatePath(`/jobs/${data.project_id}`, "layout");
  const { redirect } = await import("next/navigation");
  redirect(`/jobs/${data.project_id}/photos`);
}
