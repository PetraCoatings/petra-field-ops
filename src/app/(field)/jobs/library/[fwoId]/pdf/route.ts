import { getFormatter, getTranslations } from "next-intl/server";
import { readContent } from "@/domain/work-orders/content";
import { getProfile } from "@/lib/auth/dal";
import { parseDateOnly } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { type PdfImage, renderWorkOrderPdf } from "@/lib/work-orders/pdf";
import { signedUrls } from "@/lib/work-orders/signed-urls";
import type { ProjectSnapshot } from "@/lib/work-orders/snapshot";

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
const MAX_IMAGES = 12;

type Row = {
  fwo_number: number;
  title: string;
  revision_number: number;
  content: unknown;
  project_snapshot: ProjectSnapshot;
  published_at: string;
};

export async function GET(request: Request, ctx: RouteContext<"/jobs/library/[fwoId]/pdf">) {
  const profile = await getProfile();
  if (!profile) return new Response("Sign in required", { status: 401 });
  const { fwoId } = await ctx.params;
  const rev = new URL(request.url).searchParams.get("rev");
  if (!UUID_RE.test(fwoId) || (rev !== null && !/^\d{1,4}$/.test(rev))) return new Response("Not found", { status: 404 });

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_library_work_order", { p_fwo_id: fwoId, p_revision: rev ? Number(rev) : null });
  const wo = ((data ?? []) as Row[])[0];
  if (!wo) return new Response("Not found", { status: 404 });

  const t = await getTranslations("workOrders");
  const format = await getFormatter();
  const content = readContent(wo.content);

  // Drawings: photos are printed one per page; PDFs are listed with a link.
  const urls = await signedUrls(content.attachments);
  const images: PdfImage[] = [];
  for (const a of content.attachments.filter((x) => x.contentType === "image/png" || x.contentType === "image/jpeg").slice(0, MAX_IMAGES)) {
    const url = urls.get(a.path);
    if (!url) continue;
    try {
      const res = await fetch(url);
      if (res.ok) images.push({ name: a.name, caption: a.caption ?? null, data: Buffer.from(await res.arrayBuffer()), format: a.contentType === "image/png" ? "png" : "jpg" });
    } catch {
      // A drawing that can't be fetched is left out rather than failing the PDF.
    }
  }
  const pdfAttachments = content.attachments
    .filter((a) => a.contentType === "application/pdf" || a.contentType === "image/webp")
    .map((a) => ({ name: a.name, caption: a.caption ?? null, url: urls.get(a.path) ?? null }));

  const days = content.schedule.map((d) => ({
    title: d.title,
    when:
      [d.date && format.dateTime(parseDateOnly(d.date), { weekday: "long", month: "short", day: "numeric", year: "numeric" }), d.startTime]
        .filter(Boolean)
        .join(" · ") || null,
    steps: d.steps,
  }));

  const labels = {
    workOrder: t("pdf.workOrder"),
    workOrderN: t("view.workOrderN", { n: wo.fwo_number }),
    revisionLine: t("pdf.revisionLine", { n: wo.revision_number, when: format.dateTime(new Date(wo.published_at), { dateStyle: "medium" }) }),
    contactInfo: t("pdf.contactInfo"),
    summary: t("view.summary"),
    trailer: t("view.trailer"),
    qty: t("editor.fields.qty"),
    jobsite: t("view.jobsite"),
    mixRatios: t("view.mixRatios"),
    schedule: t("view.schedule"),
    safety: t("view.safety"),
    qcTests: t("view.qcTests"),
    target: t("pdf.target"),
    notes: t("view.notes"),
    attachments: t("view.attachments"),
    attachedPdf: t("pdf.attachedPdf"),
    products: t("view.products"),
    sheetsInApp: t("pdf.sheetsInApp"),
    important: t("view.important"),
    page: t("pdf.page"),
    of: t("pdf.of"),
  };

  const pdf = await renderWorkOrderPdf({
    labels,
    title: wo.title,
    project: wo.project_snapshot,
    content,
    days,
    images,
    pdfAttachments,
  });

  const name = `${wo.project_snapshot.name ?? "Work order"} - WO ${wo.fwo_number} rev ${wo.revision_number}.pdf`.replace(/[^\w .,()-]+/g, "_");
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
