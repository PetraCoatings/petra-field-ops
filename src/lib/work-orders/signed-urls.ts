import "server-only";
import type { Attachment } from "@/domain/work-orders/content";
import { createClient } from "@/lib/supabase/server";

/**
 * Short-lived links to a work order's files, created with the viewer's own
 * session, so Storage's access rules decide who gets them (crews on the job,
 * office staff). Links expire after an hour.
 */
export async function signedUrls(attachments: Attachment[]): Promise<Map<string, string>> {
  if (attachments.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.storage.from("fwo-files").createSignedUrls(
    attachments.map((a) => a.path),
    60 * 60,
  );
  const map = new Map<string, string>();
  for (const row of data ?? []) if (row.path && row.signedUrl) map.set(row.path, row.signedUrl);
  return map;
}
