"use client";
import { preparePhoto } from "@/lib/photos/prepare";
import { enqueuePhoto, sendPhoto } from "@/lib/offline/photo-queue";
import type { PhotoStage } from "@/domain/reports/field";

/**
 * Shrinks a photo, then uploads it; with no signal it's kept on the phone and
 * uploaded later (lib/offline/photo-queue.ts). The phone-made id means a
 * retry is never saved twice.
 */
export async function uploadPhoto(
  file: File,
  opts: { projectId: string; owner: string; stage: PhotoStage; notes?: string; issueId?: string },
): Promise<"uploaded" | "queued" | "failed"> {
  const clientId = crypto.randomUUID();
  const p = await preparePhoto(file);
  const photo = { clientId, projectId: opts.projectId, stage: opts.stage, notes: opts.notes, issueId: opts.issueId, full: p.full, thumb: p.thumb, width: p.width, height: p.height, takenAt: p.takenAt };
  const r = await sendPhoto(photo);
  if (r === "ok") return "uploaded";
  if (r === "refused") return "failed";
  await enqueuePhoto({ ...photo, owner: opts.owner });
  return "queued";
}
