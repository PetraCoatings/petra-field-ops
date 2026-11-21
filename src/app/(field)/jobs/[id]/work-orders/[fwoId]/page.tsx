import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, History, Info } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button-styles";
import { PageHeader } from "@/components/ui/page-header";
import { WorkOrderView } from "@/components/work-orders/work-order-view";
import { readContent } from "@/domain/work-orders/content";
import { acknowledgeRevision } from "@/lib/actions/work-orders";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { loadFwo, loadRevisions } from "@/lib/work-orders/queries";
import { signedUrls } from "@/lib/work-orders/signed-urls";

export async function generateMetadata({ params }: PageProps<"/jobs/[id]/work-orders/[fwoId]">): Promise<Metadata> {
  const { id, fwoId } = await params;
  const fwo = await loadFwo(id, fwoId);
  return { title: fwo?.title };
}

/** A work order on the phone. Crews confirm each new revision with "I've read this". */
export default async function FieldWorkOrderPage({ params, searchParams }: PageProps<"/jobs/[id]/work-orders/[fwoId]">) {
  const profile = await requireProfile();
  const { id, fwoId } = await params;
  const { rev } = await searchParams;
  const fwo = await loadFwo(id, fwoId); // RLS: crews only see published work orders on their jobs
  if (!fwo) notFound();
  const t = await getTranslations("workOrders");
  const format = await getFormatter();
  const revisions = await loadRevisions(fwoId);
  const current = revisions[0];

  if (!current) {
    return (
      <>
        <PageHeader title={fwo.title} backHref={`/jobs/${id}`} backLabel={t("backToJob")} />
        <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{t("view.notPublished")}</p>
      </>
    );
  }

  const wanted = typeof rev === "string" ? Number(rev) : NaN;
  const shown = revisions.find((r) => r.revision_number === wanted) ?? current;
  const isCurrent = shown.id === current.id;
  const isCrew = profile.role === "installer" || profile.role === "crew_lead";

  const supabase = await createClient();
  const { data: myAck } = isCrew
    ? await supabase
        .from("fwo_acknowledgments")
        .select("acknowledged_at")
        .eq("fwo_revision_id", current.id)
        .eq("employee_id", profile.employeeId)
        .maybeSingle()
    : { data: null };
  const content = readContent(shown.content);
  const urls = await signedUrls(content.attachments);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="space-y-4">
      <PageHeader title={fwo.title} backHref={`/jobs/${id}`} backLabel={t("backToJob")} />

      {!isCurrent && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-l-8 border-neutral-500 bg-neutral-200 p-4">
          <p className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <History aria-hidden className="size-6 shrink-0" />
            {t("view.oldRevision", { n: shown.revision_number, current: current.revision_number })}
          </p>
          <Link href={`/jobs/${id}/work-orders/${fwoId}`} className={buttonClasses("secondary", "md")}>
            {t("view.seeCurrent")}
          </Link>
        </div>
      )}

      {isCurrent && isCrew && !myAck && (
        <section aria-labelledby="ack-title" className="space-y-3 rounded-2xl border-l-8 border-accent-500 bg-amber-50 p-4">
          <h2 id="ack-title" className="text-xl font-bold text-amber-950">
            {current.revision_number > 1 ? t("view.updatedBanner", { n: current.revision_number }) : t("view.newBanner")}
          </h2>
          {current.change_summary && (
            <p className="text-base text-amber-950">
              <span className="font-semibold">{t("view.whatChanged")}</span> {current.change_summary}
            </p>
          )}
          <p className="text-base text-amber-950">{t("view.readThenConfirm")}</p>
        </section>
      )}

      {isCurrent && isCrew && myAck && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-green-50 px-4 py-3 text-base font-semibold text-green-900">
          <CircleCheck aria-hidden className="size-6 shrink-0 text-green-700" />
          {t("view.confirmed", { n: current.revision_number, when: when(myAck.acknowledged_at as string) })}
        </p>
      )}

      {isCurrent && !isCrew && (
        <p className="flex items-center gap-2 rounded-2xl bg-brand-50 px-4 py-3 text-base text-brand-900">
          <Info aria-hidden className="size-5 shrink-0" />
          {t("view.officeNote", { n: current.revision_number })}
        </p>
      )}

      <WorkOrderView title={fwo.title} fwoNumber={fwo.fwo_number} content={content} project={shown.project_snapshot} fileUrls={urls} />

      {isCurrent && isCrew && !myAck && (
        <form action={acknowledgeRevision} className="sticky bottom-[env(safe-area-inset-bottom)] z-10">
          <input type="hidden" name="revisionId" value={current.id} />
          <input type="hidden" name="projectId" value={id} />
          <input type="hidden" name="fwoId" value={fwoId} />
          <button type="submit" className={buttonClasses("primary", "lg", "w-full shadow-lg")}>
            <CircleCheck aria-hidden className="size-6" />
            {t("view.confirmButton", { n: current.revision_number })}
          </button>
        </form>
      )}

      {revisions.length > 1 && (
        <section aria-labelledby="rev-history" className="rounded-2xl border border-neutral-200 bg-white p-4">
          <h2 id="rev-history" className="mb-2 text-lg font-bold">
            {t("editor.history")}
          </h2>
          <ul className="divide-y divide-neutral-200">
            {revisions.map((r) => (
              <li key={r.id} className="py-2">
                {r.id === shown.id ? (
                  <span className="font-semibold">{t("view.revisionN", { n: r.revision_number })}</span>
                ) : (
                  <Link href={`/jobs/${id}/work-orders/${fwoId}?rev=${r.revision_number}`} className="font-semibold text-brand-700 underline">
                    {t("view.revisionN", { n: r.revision_number })}
                  </Link>
                )}
                <span className="text-sm text-neutral-600"> · {when(r.published_at)}</span>
                {r.change_summary && <p className="text-sm text-neutral-800">{r.change_summary}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
