import { getProfile, needsTwoStep } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { buildCloseout } from "@/lib/closeout/build";
import { renderCloseoutPdf } from "@/lib/closeout/pdf";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /jobs/<job id>/closeout
 *
 * The job closeout package (office: project managers and office admins):
 * cover, work order(s), every submitted daily report, QC readings, jobsite
 * issues and all photos, in one PDF. Built fresh each time.
 *
 * Photo-heavy packages can be large, so the PDF is stored privately and the
 * browser is sent to a 10-minute download link (web responses are limited in
 * size). It's kept under the storage bucket's 20 MB limit: if the first build
 * is too big, photos are shrunk further and it's built again.
 */
export const maxDuration = 300;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT_BYTES = 19 * 1024 * 1024;

export async function GET(_request: Request, ctx: RouteContext<"/jobs/[id]/closeout">) {
  const profile = await getProfile();
  if (!profile) return new Response("Sign in required", { status: 401 });
  if (!canAccessManagement(profile.role) || needsTwoStep(profile)) return new Response("Office only", { status: 403 });
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  let pdf: Buffer | null = null;
  let fileName = "Closeout package.pdf";
  for (const px of [1400, 1000, 700]) {
    const built = await buildCloseout(supabase, id, px);
    if (!built) return new Response("Not found", { status: 404 });
    fileName = built.fileName;
    pdf = await renderCloseoutPdf(built.model);
    if (pdf.length <= LIMIT_BYTES) break;
  }
  if (!pdf) return new Response("Not found", { status: 404 });

  if (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const admin = createAdminClient();
    const path = `closeout/${id}/package.pdf`;
    const up = await admin.storage.from("fwo-files").upload(path, pdf, { contentType: "application/pdf", upsert: true });
    if (!up.error) {
      const { data } = await admin.storage.from("fwo-files").createSignedUrl(path, 600, { download: fileName });
      if (data?.signedUrl) return Response.redirect(data.signedUrl, 303);
    }
  }
  // Without storage (local development), or if storing failed: send it directly.
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
