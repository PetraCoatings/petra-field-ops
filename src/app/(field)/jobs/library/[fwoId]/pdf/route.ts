import { getTranslations } from "next-intl/server";
import { getProfile } from "@/lib/auth/dal";
import { assemblePdf } from "@/lib/pdf/assemble";
import { deliverPdf } from "@/lib/pdf/deliver";
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
 * a revision's PDF never changes. Attached PDF drawings print after it.
 */
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request, ctx: RouteContext<"/jobs/library/[fwoId]/pdf">) {
  const profile = await getProfile();
  if (!profile) return new Response("Sign in required", { status: 401 });
  const { fwoId } = await ctx.params;
  const rev = new URL(request.url).searchParams.get("rev");
  if (!UUID_RE.test(fwoId) || (rev !== null && !/^\d{1,4}$/.test(rev))) return new Response("Not found", { status: 404 });

  const built = await workOrderPdfProps(await createClient(), fwoId, rev ? Number(rev) : null);
  if (!built) return new Response("Not found", { status: 404 });
  const t = await getTranslations("workOrders.pdf");
  const { pdf } = await assemblePdf([await renderWorkOrderPdf(built.props), ...built.attachedPdfs], (n, total) => `${t("page")} ${n} ${t("of")} ${total}`);
  return deliverPdf(pdf, built.fileName, `printouts/${fwoId}/rev-${rev ?? "current"}.pdf`);
}
