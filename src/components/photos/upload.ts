"use client";
import { createClient } from "@/lib/supabase/client";
import { preparePhoto } from "@/lib/photos/prepare";
import { recordPhoto } from "@/lib/actions/photos";
import type { PhotoStage } from "@/domain/reports/field";

/** Shrinks, uploads and records one photo. A retry reuses the same id, so nothing is saved twice. */
export async function uploadPhoto(file: File, opts: { projectId: string; stage: PhotoStage; notes?: string; issueId?: string; clientId?: string }): Promise<boolean> {
  const clientId = opts.clientId ?? crypto.randomUUID();
  const p = await preparePhoto(file);
  const supabase = createClient();
  const base = `${opts.projectId}/${clientId}`;
  for (const [path, blob] of [
    [`${base}.jpg`, p.full],
    [`${base}_thumb.jpg`, p.thumb],
  ] as const) {
    const { error } = await supabase.storage.from("job-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
    if (error && !/exists|duplicate/i.test(error.message)) return false;
  }
  const r = await recordPhoto({
    clientId,
    projectId: opts.projectId,
    stage: opts.stage,
    notes: opts.notes,
    width: p.width,
    height: p.height,
    sizeBytes: p.full.size,
    takenAt: p.takenAt,
    issueId: opts.issueId,
  });
  return r.ok;
}
