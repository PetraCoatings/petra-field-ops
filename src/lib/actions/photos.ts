"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PHOTO_STAGES } from "@/domain/reports/field";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const recordSchema = z.object({
  clientId: uuid,
  projectId: uuid,
  stage: z.enum(PHOTO_STAGES),
  notes: z.string().trim().max(500).optional(),
  width: z.number().int().min(1).max(4096),
  height: z.number().int().min(1).max(4096),
  sizeBytes: z.number().int().min(1).max(20_971_520),
  takenAt: z.string().datetime({ offset: true }),
  issueId: uuid.optional(),
});

/**
 * Saves a photo's record after the phone uploaded the files to
 * job-photos/{projectId}/{clientId}.jpg (and _thumb.jpg). A retry with the
 * same clientId is accepted once.
 */
export async function recordPhoto(payload: z.input<typeof recordSchema>): Promise<{ ok: boolean }> {
  await requireProfile();
  const parsed = recordSchema.safeParse(payload);
  if (!parsed.success) return { ok: false };
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("photos").insert({
    client_id: p.clientId,
    project_id: p.projectId,
    stage: p.stage,
    notes: p.notes || null,
    storage_path: `${p.projectId}/${p.clientId}.jpg`,
    thumb_path: `${p.projectId}/${p.clientId}_thumb.jpg`,
    width: p.width,
    height: p.height,
    size_bytes: p.sizeBytes,
    taken_at: p.takenAt,
    issue_id: p.issueId ?? null,
  });
  if (error && error.code !== "23505") return { ok: false };
  revalidatePath(`/jobs/${p.projectId}`, "layout");
  return { ok: true };
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
  const { data } = await supabase.from("photos").delete().eq("id", id.data).select("project_id, storage_path, thumb_path").maybeSingle();
  if (!data) return;
  if (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    await createAdminClient().storage.from("job-photos").remove([data.storage_path as string, data.thumb_path as string]);
  }
  revalidatePath(`/jobs/${data.project_id}`, "layout");
  const { redirect } = await import("next/navigation");
  redirect(`/jobs/${data.project_id}/photos`);
}
