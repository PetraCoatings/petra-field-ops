import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { NotebookPen } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { openDailyReport } from "@/lib/actions/daily-reports";
import type { ReportSummary } from "@/lib/reports/list";

/** "Daily reports" on the job screen: today's report for the crew lead, and the recent ones. */
export async function DailyReportsCard({ projectId, reports, canWrite, today }: { projectId: string; reports: ReportSummary[]; canWrite: boolean; today: string }) {
  const t = await getTranslations("reports");
  const locale = await getLocale();
  const d = (s: string) => new Intl.DateTimeFormat(locale, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`));
  const todays = reports.find((r) => r.date === today);
  const tone = (s: ReportSummary["status"]) =>
    s === "accepted" ? "bg-green-100 text-green-900" : s === "submitted" ? "bg-brand-100 text-brand-900" : s === "correction_requested" ? "bg-red-100 text-red-900" : "bg-neutral-100 text-neutral-800";
  if (!canWrite && reports.length === 0) return null;
  return (
    <section aria-labelledby="dfr-card" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 id="dfr-card" className="flex items-center gap-2 text-lg font-bold">
        <NotebookPen aria-hidden className="size-6 text-brand-700" />
        {t("title")}
      </h2>
      {canWrite && !todays && <p className="text-sm text-neutral-700">{t("optional")}</p>}
      {canWrite && (
        <form action={openDailyReport}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="date" value={today} />
          <button type="submit" className={`${buttonClasses("secondary", "md")} w-full`}>
            {todays ? t("openToday") : t("startToday")}
          </button>
        </form>
      )}
      {reports.length > 0 && (
        <ul className="divide-y divide-neutral-200">
          {reports.map((r) => (
            <li key={r.id}>
              <Link href={`/jobs/${projectId}/reports/${r.date}`} className="flex min-h-11 items-center justify-between gap-2 py-2 hover:bg-neutral-50">
                <span className="font-semibold">{d(r.date)}</span>
                <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${tone(r.status)}`}>{t(`statuses.${r.status}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
