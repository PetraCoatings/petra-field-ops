import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { WorkOrderView } from "@/components/work-orders/work-order-view";
import { readContent } from "@/domain/work-orders/content";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { liveProjectSnapshot, loadFwo } from "@/lib/work-orders/queries";
import { signedUrls } from "@/lib/work-orders/signed-urls";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("workOrders.editor");
  return { title: t("preview") };
}

/** The saved draft exactly as crews will see it once published. */
export default async function WorkOrderPreviewPage({ params }: PageProps<"/manage/projects/[id]/work-orders/[fwoId]/preview">) {
  await requireRole("project_manager", "office_admin");
  const { id, fwoId } = await params;
  const fwo = await loadFwo(id, fwoId);
  if (!fwo) notFound();
  const supabase = await createClient();
  const { data: draft } = await supabase.from("fwo_drafts").select("content").eq("fwo_id", fwoId).maybeSingle();
  const content = readContent(draft?.content);
  const [project, urls, t] = await Promise.all([liveProjectSnapshot(id), signedUrls(content.attachments), getTranslations("workOrders.editor")]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={t("preview")} backHref={`/manage/projects/${id}/work-orders/${fwoId}`} backLabel={t("backToEditor")} />
      <Alert tone="info">{t("previewNote")}</Alert>
      <WorkOrderView title={fwo.title} fwoNumber={fwo.fwo_number} content={content} project={project} fileUrls={urls} />
    </div>
  );
}
