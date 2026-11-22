import Link from "next/link";
import { CircleCheck, History } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { buttonClasses } from "@/components/ui/button-styles";
import { readContent } from "@/domain/work-orders/content";
import { acknowledgeRevision } from "@/lib/actions/work-orders";
import type { Profile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { signedUrls } from "@/lib/work-orders/signed-urls";
import type { ProjectSnapshot } from "@/lib/work-orders/snapshot";
import { canLoadTrailer } from "@/lib/work-orders/checklists";
import { ChecklistSummary } from "./checklist-summary";
import { PdfLink } from "./pdf-link";
import { WorkOrderView } from "./work-order-view";

type Fwo = { id: string; fwo_number: number; title: string };
type Revision = {
  id: string;
  revision_number: number;
  content: unknown;
  project_snapshot: ProjectSnapshot;
  change_summary: string | null;
  published_at: string;
};

/**
 * The current revision of a work order, shown inline on the job screen, with
 * the "I've read this" banner and button for the crew.
 */
export async function WorkOrderOnJob({
  projectId,
  fwo,
  revision,
  profile,
  showTitle,
}: {
  projectId: string;
  fwo: Fwo;
  revision: Revision;
  profile: Profile;
  /** Show "Work order 2 · Recoat" above it (when a job has more than one). */
  showTitle: boolean;
}) {
  const t = await getTranslations("workOrders");
  const format = await getFormatter();
  const isCrew = profile.role === "installer" || profile.role === "crew_lead";
  const supabase = await createClient();
  const { data: myAck } = isCrew
    ? await supabase
        .from("fwo_acknowledgments")
        .select("acknowledged_at")
        .eq("fwo_revision_id", revision.id)
        .eq("employee_id", profile.employeeId)
        .maybeSingle()
    : { data: null };
  const content = readContent(revision.content);
  const urls = await signedUrls(content.attachments);
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  return (
    <section id={`wo-${fwo.id}`} aria-label={`${t("view.workOrderN", { n: fwo.fwo_number })} · ${fwo.title}`} className="scroll-mt-20 space-y-4">
      {showTitle && (
        <h2 className="border-t-4 border-brand-700 pt-3 text-xl font-bold">
          {t("view.workOrderN", { n: fwo.fwo_number })} · {fwo.title}
        </h2>
      )}

      {isCrew && !myAck && (
        <div className="space-y-2 rounded-2xl border-l-8 border-accent-500 bg-amber-50 p-4">
          <p className="text-xl font-bold text-amber-950">
            {revision.revision_number > 1 ? t("view.updatedBanner", { n: revision.revision_number }) : t("view.newBanner")}
          </p>
          {revision.change_summary && (
            <p className="text-base text-amber-950">
              <span className="font-semibold">{t("view.whatChanged")}</span> {revision.change_summary}
            </p>
          )}
          <p className="text-base text-amber-950">{t("view.readThenConfirm")}</p>
        </div>
      )}
      {isCrew && myAck && (
        <p role="status" className="flex items-center gap-2 rounded-2xl bg-green-50 px-4 py-3 text-base font-semibold text-green-900">
          <CircleCheck aria-hidden className="size-6 shrink-0 text-green-700" />
          {t("view.confirmed", { n: revision.revision_number, when: when(myAck.acknowledged_at as string) })}
        </p>
      )}

      <ChecklistSummary projectId={projectId} fwoId={fwo.id} hasTrailerList={content.trailerMaterials.length > 0} canEdit={canLoadTrailer(profile)} />

      <WorkOrderView title={fwo.title} fwoNumber={fwo.fwo_number} content={content} project={revision.project_snapshot} fileUrls={urls} showHeader={false} />

      {isCrew && !myAck && (
        <form action={acknowledgeRevision} className="sticky bottom-[env(safe-area-inset-bottom)] z-10">
          <input type="hidden" name="revisionId" value={revision.id} />
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="fwoId" value={fwo.id} />
          <button type="submit" className={buttonClasses("primary", "lg", "w-full shadow-lg")}>
            <CircleCheck aria-hidden className="size-6" />
            {t("view.confirmButton", { n: revision.revision_number })}
          </button>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <PdfLink fwoId={fwo.id} revision={revision.revision_number} />
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-600">
        <span>{t("view.revisionPublished", { n: revision.revision_number, when: when(revision.published_at) })}</span>
        {revision.revision_number > 1 && (
          <Link href={`/jobs/${projectId}/work-orders/${fwo.id}?rev=${revision.revision_number - 1}`} className="inline-flex items-center gap-1 font-semibold text-brand-700 underline">
            <History aria-hidden className="size-4" />
            {t("view.earlierRevisions")}
          </Link>
        )}
      </p>
    </section>
  );
}
