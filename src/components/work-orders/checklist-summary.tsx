import Link from "next/link";
import { ChevronRight, ClipboardCheck, TriangleAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { checklistCounts, loadChecklist } from "@/lib/work-orders/checklists";

/**
 * "Loading checklist: 9 of 14 loaded · 1 missing" with a link to the checklist.
 * Shown on the job screen and in the office's work order editor.
 */
export async function ChecklistSummary({
  projectId,
  fwoId,
  hasTrailerList,
  canEdit,
  showMissingDetails = false,
}: {
  projectId: string;
  fwoId: string;
  hasTrailerList: boolean;
  canEdit: boolean;
  /** List each missing item and its note (office view). */
  showMissingDetails?: boolean;
}) {
  if (!hasTrailerList) return null;
  const t = await getTranslations("checklist");
  const checklist = await loadChecklist(fwoId);
  const counts = checklist ? checklistCounts(checklist.items) : null;
  const done = counts && counts.total > 0 && counts.loaded === counts.total;
  const status = !counts
    ? t("summaryNotStarted")
    : [t("progress", { loaded: counts.loaded, total: counts.total }), counts.missing.length ? t("missingCount", { count: counts.missing.length }) : null]
        .filter(Boolean)
        .join(" · ");
  const border = counts?.missing.length ? "border-red-600" : done ? "border-green-600" : "border-neutral-200";

  return (
    <div className={`rounded-2xl border-2 bg-white shadow-sm ${border}`}>
      <Link href={`/jobs/${projectId}/checklist/${fwoId}`} className="flex min-h-16 items-center gap-3 p-4">
        <ClipboardCheck aria-hidden className={`size-7 shrink-0 ${done ? "text-green-700" : "text-brand-700"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold">{t("title")}</span>
          <span className={`block text-sm font-semibold ${counts?.missing.length ? "text-red-800" : "text-neutral-700"}`}>{status}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-brand-700">{canEdit ? (counts ? t("open") : t("start")) : t("view")}</span>
        <ChevronRight aria-hidden className="size-5 shrink-0 text-neutral-500" />
      </Link>
      {showMissingDetails && counts && counts.missing.length > 0 && (
        <ul className="space-y-1 border-t border-neutral-200 px-4 py-3">
          {counts.missing.map((m) => (
            <li key={m.id} className="flex gap-2 text-base text-red-900">
              <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
              <span>
                <span className="font-semibold">{m.item}</span>
                {m.note && <span>: {m.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
