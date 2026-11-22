import { getProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /documents/<version id>/file: the PDF itself, served from the app's own
 * address so the in-app viewer can show it and the phone can save it for
 * offline use. Same rules as /documents/<version id>: Row Level Security
 * decides whether this person may see it.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, ctx: RouteContext<"/documents/[versionId]/file">) {
  const profile = await getProfile();
  if (!profile) return new Response("Sign in required", { status: 401 });
  const { versionId } = await ctx.params;
  if (!UUID_RE.test(versionId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: version } = await supabase.from("document_versions").select("storage_path, file_name").eq("id", versionId).maybeSingle();
  if (!version) return new Response("Not found", { status: 404 });
  const { data: blob, error } = await supabase.storage.from("product-docs").download(version.storage_path as string);
  if (error || !blob) return new Response("Not found", { status: 404 });
  const name = String(version.file_name).replace(/[^\w .,()-]+/g, "_");
  return new Response(blob.stream(), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      // Always ask the server (so access rules apply every time); with no signal
      // the viewer uses the copy saved "on this phone" instead.
      "Cache-Control": "private, no-cache",
    },
  });
}
