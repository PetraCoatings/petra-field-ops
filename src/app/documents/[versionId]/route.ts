import { getProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /documents/<version id>: opens one data sheet version (PDF).
 * Row Level Security decides whether this person may see the document (every
 * active employee may see active documents; the office sees all); the file is
 * then served through a link that expires after five minutes.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, ctx: RouteContext<"/documents/[versionId]">) {
  const profile = await getProfile();
  if (!profile) return new Response("Sign in required", { status: 401 });
  const { versionId } = await ctx.params;
  if (!UUID_RE.test(versionId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: version } = await supabase.from("document_versions").select("storage_path, file_name").eq("id", versionId).maybeSingle();
  if (!version) return new Response("Not found", { status: 404 });
  const { data } = await supabase.storage
    .from("product-docs")
    .createSignedUrl(version.storage_path as string, 300, { download: false });
  if (!data?.signedUrl) return new Response("Not found", { status: 404 });
  return Response.redirect(data.signedUrl, 302);
}
