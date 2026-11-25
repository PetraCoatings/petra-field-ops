import { getProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { renderWorkOrderPdf } from "@/lib/work-orders/pdf";
import { workOrderPdfProps } from "@/lib/work-orders/pdf-props";

/**
 * GET /jobs/library/<work order id>/pdf[?rev=N]
 *
 * A published work order revision as a PDF. Reads through the same database
 * function as "Past work orders", so the same rules apply: the person's own
 * jobs, finished jobs, or (office) everything; customer contacts removed on
 * jobs the person wasn't on. Built from the permanent published revision, so
 * a revision's PDF never changes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, ctx: RouteContext<"/jobs/library/[fwoId]/pdf">) {
  const profile = await getProfile();
  if (!profile) return new Response("Sign in required", { status: 401 });
  const { fwoId } = await ctx.params;
  const rev = new URL(request.url).searchParams.get("rev");
  if (!UUID_RE.test(fwoId) || (rev !== null && !/^\d{1,4}$/.test(rev))) return new Response("Not found", { status: 404 });

  const built = await workOrderPdfProps(await createClient(), fwoId, rev ? Number(rev) : null);
  if (!built) return new Response("Not found", { status: 404 });
  const pdf = await renderWorkOrderPdf(built.props);
  const name = built.fileName;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
