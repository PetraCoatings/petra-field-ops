import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOTO_STAGES } from "@/domain/reports/field";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const photoRecordSchema = z.object({
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
export type PhotoRecordInput = z.input<typeof photoRecordSchema>;

/**
 * Saves a photo's record after the phone uploaded its files to
 * job-photos/{projectId}/{clientId}.jpg (and _thumb.jpg). The same clientId
 * twice is accepted once (a retry from the phone's queue).
 */
export async function recordPhotoCore(supabase: SupabaseClient, payload: unknown): Promise<{ ok: boolean; projectId?: string }> {
  const parsed = photoRecordSchema.safeParse(payload);
  if (!parsed.success) return { ok: false };
  const p = parsed.data;
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
  return { ok: true, projectId: p.projectId };
}
