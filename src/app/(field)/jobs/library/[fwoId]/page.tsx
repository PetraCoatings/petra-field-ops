import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Info } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button-styles";
import { PageHeader } from "@/components/ui/page-header";
import { WorkOrderView } from "@/components/work-orders/work-order-view";
import { readContent } from "@/domain/work-orders/content";
import { requireProfile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import type { ProjectSnapshot } from "@/lib/work-orders/snapshot";
import { signedUrls } from "@/lib/work-orders/signed-urls";

type LibraryWorkOrder = {
  fwo_id: string;
  project_id: string;
  fwo_number: number;
  title: string;
  revision_number: number;
  current_revision_number: number;
  content: unknown;
  project_snapshot: ProjectSnapshot;
  change_summary: string | null;
  published_at: string;
  on_this_job: boolean;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function load(fwoId: string, rev?: number): Promise<LibraryWorkOrder | null> {
  if (!UUID_RE.test(fwoId)) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_library_work_order", { p_fwo_id: fwoId, p_revision: rev ?? null });
  return ((data ?? []) as LibraryWorkOrder[])[0] ?? null;
}

export async function generateMetadata({ params }: PageProps<"/jobs/library/[fwoId]">): Promise<Metadata> {
  const wo = await load((await params).fwoId);
  return { title: wo?.project_snapshot.name ?? undefined };
}

/** A work order from the "Past work orders" library (read-only, no acknowledging). */
export default async function LibraryWorkOrderPage({ params, searchParams }: PageProps<"/jobs/library/[fwoId]">) {
  const profile = await requireProfile();
  const { fwoId } = await params;
  const { rev } = await searchParams;
  const wanted = typeof rev === "string" && /^\d+$/.test(rev) ? Number(rev) : undefined;
  const wo = await load(fwoId, wanted);
  if (!wo) notFound();
  const t = await getTranslations("jobCenter");
  const format = await getFormatter();
  const content = readContent(wo.content);
  const urls = await signedUrls(content.attachments);
  const office = canAccessManagement(profile.role);
  const isOld = wo.revision_number !== wo.current_revision_number;

  return (
    <div className="space-y-4">
      <PageHeader title={wo.project_snapshot.name ?? wo.title} backHref="/jobs?tab=past" backLabel={t("tabs.past")} />
      <p className="text-sm text-neutral-600">
        {t("publishedOn", { revision: wo.revision_number, when: format.dateTime(new Date(wo.published_at), { dateStyle: "medium" }) })}
      </p>
      {isOld && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-neutral-200 p-4">
          <p className="flex items-center gap-2 text-base font-semibold">
            <History aria-hidden className="size-5 shrink-0" />
            {t("oldRevision", { n: wo.revision_number, current: wo.current_revision_number })}
          </p>
          <Link href={`/jobs/library/${fwoId}`} className={buttonClasses("secondary", "md")}>
            {t("seeCurrent")}
          </Link>
        </div>
      )}
      {wo.on_this_job ? (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-base text-brand-900">
          <span className="flex items-center gap-2">
            <Info aria-hidden className="size-5 shrink-0" />
            {t("yourJob")}
          </span>
          <Link href={`/jobs/${wo.project_id}`} className="font-semibold underline">
            {t("openJob")}
          </Link>
        </p>
      ) : (
        !office && (
          <p className="flex items-center gap-2 rounded-2xl bg-neutral-200 px-4 py-3 text-base text-neutral-900">
            <Info aria-hidden className="size-5 shrink-0" />
            {t("contactsHidden")}
          </p>
        )
      )}
      <WorkOrderView title={wo.title} fwoNumber={wo.fwo_number} content={content} project={wo.project_snapshot} fileUrls={urls} />
      {wo.current_revision_number > 1 && (
        <p className="text-sm text-neutral-700">
          {Array.from({ length: wo.current_revision_number }, (_, i) => i + 1).map((n) => (
            <span key={n} className="mr-3">
              {n === wo.revision_number ? (
                <strong>{t("revisionN", { n })}</strong>
              ) : (
                <Link href={`/jobs/library/${fwoId}?rev=${n}`} className="font-semibold text-brand-700 underline">
                  {t("revisionN", { n })}
                </Link>
              )}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
