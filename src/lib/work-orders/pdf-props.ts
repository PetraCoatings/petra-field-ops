import "server-only";
import { getFormatter, getTranslations } from "next-intl/server";
import { readContent } from "@/domain/work-orders/content";
import { parseDateOnly } from "@/lib/dates";
import type { createClient } from "@/lib/supabase/server";
import { type PdfImage, WorkOrderPages } from "@/lib/work-orders/pdf";
import { signedUrls } from "@/lib/work-orders/signed-urls";
import type { ProjectSnapshot } from "@/lib/work-orders/snapshot";

const MAX_IMAGES = 12;

type Row = {
  fwo_number: number;
  title: string;
  revision_number: number;
  content: unknown;
  project_snapshot: ProjectSnapshot;
  published_at: string;
};

export type WorkOrderPdfProps = Parameters<typeof WorkOrderPages>[0];

/**
 * Everything the work order PDF needs for one published revision (the current
 * one when rev is null), read through get_library_work_order, so the same
 * access rules apply as in "Past work orders". Null when not visible.
 */
export async function workOrderPdfProps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  fwoId: string,
  rev: number | null,
): Promise<{ props: WorkOrderPdfProps; fileName: string; attachedPdfs: Buffer[] } | null> {
  const { data } = await supabase.rpc("get_library_work_order", { p_fwo_id: fwoId, p_revision: rev });
  const wo = ((data ?? []) as Row[])[0];
  if (!wo) return null;

  const t = await getTranslations("workOrders");
  const format = await getFormatter();
  const content = readContent(wo.content);

  // Drawings: pictures are printed one per page; attached PDFs (shop drawings,
  // diagrams) are printed in full after the work order (see assemblePdf).
  const urls = await signedUrls(content.attachments);
  const fetchBytes = async (path: string): Promise<Buffer | null> => {
    const url = urls.get(path);
    if (!url) return null;
    try {
      const res = await fetch(url);
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    } catch {
      return null; // a drawing that can't be fetched is left out rather than failing the PDF
    }
  };
  const images: PdfImage[] = [];
  for (const a of content.attachments.filter((x) => x.contentType.startsWith("image/")).slice(0, MAX_IMAGES)) {
    let data = await fetchBytes(a.path);
    if (!data) continue;
    let fmt: "png" | "jpg" = a.contentType === "image/png" ? "png" : "jpg";
    if (a.contentType !== "image/png" && a.contentType !== "image/jpeg") {
      // WebP and other picture types: converted for the PDF.
      try {
        const sharp = (await import("sharp")).default;
        data = await sharp(data).rotate().jpeg({ quality: 85 }).toBuffer();
        fmt = "jpg";
      } catch {
        continue;
      }
    }
    images.push({ name: a.name, caption: a.caption ?? null, data, format: fmt });
  }
  const pdfList = content.attachments.filter((a) => a.contentType === "application/pdf");
  const attachedPdfs: Buffer[] = [];
  for (const a of pdfList.slice(0, MAX_IMAGES)) {
    const bytes = await fetchBytes(a.path);
    if (bytes) attachedPdfs.push(bytes);
  }
  const pdfAttachments = pdfList.map((a) => ({ name: a.name, caption: a.caption ?? null, url: urls.get(a.path) ?? null }));

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

  const props: WorkOrderPdfProps = {
    labels,
    title: wo.title,
    project: wo.project_snapshot,
    content,
    days,
    images,
    pdfAttachments,
  };

  const fileName = `${wo.project_snapshot.name ?? "Work order"} - WO ${wo.fwo_number} rev ${wo.revision_number}.pdf`.replace(/[^\w .,()-]+/g, "_");
  return { props, fileName, attachedPdfs };
}
