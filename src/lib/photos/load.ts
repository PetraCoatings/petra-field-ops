import "server-only";
import { createClient } from "@/lib/supabase/server";

export type PhotoRow = {
  id: string;
  stage: string;
  notes: string | null;
  taken_at: string | null;
  created_at: string;
  uploaded_by: string | null;
  storage_path: string;
  thumb_path: string;
  issue_id: string | null;
  thumbUrl: string | null;
};

/** A job's photos (newest first) with short-lived links to their thumbnails. */
export async function jobPhotos(projectId: string, opts: { stage?: string; limit?: number; issueId?: string } = {}): Promise<{ photos: PhotoRow[]; total: number }> {
  const supabase = await createClient();
  let q = supabase
    .from("photos")
    .select("id, stage, notes, taken_at, created_at, uploaded_by, storage_path, thumb_path, issue_id", { count: "exact" })
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 60);
  if (opts.stage) q = q.eq("stage", opts.stage);
  if (opts.issueId) q = q.eq("issue_id", opts.issueId);
  const { data, count } = await q;
  const rows = (data ?? []) as Omit<PhotoRow, "thumbUrl">[];
  const urls = rows.length ? (await supabase.storage.from("job-photos").createSignedUrls(rows.map((r) => r.thumb_path), 3600)).data ?? [] : [];
  return { photos: rows.map((r, i) => ({ ...r, thumbUrl: urls[i]?.signedUrl ?? null })), total: count ?? rows.length };
}
