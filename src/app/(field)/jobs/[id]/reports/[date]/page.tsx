import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button-styles";
import { DfrEditor } from "@/components/reports/dfr-editor";
import { SaveForOffline } from "@/components/offline/save-for-offline";
import { DfrView } from "@/components/reports/dfr-view";
import { ReviewBox } from "@/components/reports/review-box";
import { ReopenBox } from "@/components/reports/reopen-box";
import { requireProfile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";
import { openDailyReport } from "@/lib/actions/daily-reports";
import { pickerProducts } from "@/lib/library/picker-products";
import { reportContext } from "@/lib/reports/context";
import { canWriteReport } from "@/lib/reports/list";
import { directoryNames } from "@/lib/db/queries";
import type { DfrContent } from "@/domain/reports/dfr";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("reports");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A job's daily report for one day: the crew lead edits and submits; others read; the office reviews. */
export default async function DailyReportPage({ params, searchParams }: PageProps<"/jobs/[id]/reports/[date]">) {
  const profile = await requireProfile();
  const { id, date } = await params;
  if (!UUID.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();
  const sp = await searchParams;
  const t = await getTranslations("reports");
  const format = await getFormatter();
  const locale = await getLocale();
  const supabase = await createClient();
  const { data: job } = await supabase.from("projects").select("id, name, crew_lead_id, project_assignments(employee_id)").eq("id", id).maybeSingle();
  if (!job) notFound();
  const jobRow = job as unknown as { id: string; name: string; crew_lead_id: string | null; project_assignments: { employee_id: string }[] };
  const { data: dfr } = await supabase.from("daily_field_reports").select("*").eq("project_id", id).eq("report_date", date).maybeSingle();
  const canWrite = canWriteReport(profile, jobRow);
  const dayLabel = new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const header = <PageHeader title={t("pageTitle", { date: dayLabel })} backHref={`/jobs/${id}`} backLabel={jobRow.name} />;

  if (!dfr) {
    return (
      <>
        {header}
        <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4">
          <p>{t("noReport")}</p>
          {canWrite && (
            <form action={openDailyReport}>
              <input type="hidden" name="projectId" value={id} />
              <input type="hidden" name="date" value={date} />
              <button type="submit" className={buttonClasses("primary", "lg")}>
                {t("startThis")}
              </button>
            </form>
          )}
        </div>
      </>
    );
  }

  const { data: versionRows } = await supabase.from("dfr_versions").select("version_number, content, submitted_by, submitted_at").eq("dfr_id", dfr.id).order("version_number", { ascending: false });
  const versions = (versionRows ?? []) as { version_number: number; content: DfrContent; submitted_by: string | null; submitted_at: string }[];
  const { data: reopenRows } = await supabase.from("dfr_reopens").select("accepted_version, accepted_by, accepted_at, reason, reopened_by, reopened_at").eq("dfr_id", dfr.id).order("reopened_at");
  const reopens = (reopenRows ?? []) as { accepted_version: number; accepted_by: string | null; accepted_at: string | null; reason: string; reopened_by: string | null; reopened_at: string }[];
  const names = await directoryNames([
    ...versions.map((v) => v.submitted_by),
    dfr.correction_by,
    dfr.accepted_by,
    ...jobRow.project_assignments.map((a) => a.employee_id),
    jobRow.crew_lead_id,
    ...reopens.flatMap((r) => [r.accepted_by, r.reopened_by]),
  ]);
  const name = (x: string | null) => (x ? (names.get(x)?.display_name ?? "?") : "?");
  const status = dfr.status as "draft" | "submitted" | "correction_requested" | "accepted";
  // A report sent back is the crew lead's to fix: the office sees its status,
  // with a button to edit it themselves instead (?edit=1).
  const office = canAccessManagement(profile.role);
  const editing = canWrite && (status === "draft" || (status === "correction_requested" && (!office || sp.edit === "1")));
  const when = (s: string) => format.dateTime(new Date(s), { dateStyle: "medium", timeStyle: "short" });

  if (editing) {
    const crewIds = [...new Set([jobRow.crew_lead_id, ...jobRow.project_assignments.map((a) => a.employee_id)].filter((x): x is string => Boolean(x)))];
    const [products, ctx] = await Promise.all([pickerProducts(), reportContext()]);
    return (
      <>
        {header}
        <SaveForOffline />
        <DfrEditor
          key={dfr.version as number}
          id={dfr.id as string}
          owner={profile.employeeId}
          reportLabel={`${jobRow.name} · ${dayLabel}`}
          initial={dfr.draft as Partial<DfrContent>}
          version={dfr.version as number}
          jobCrew={crewIds.map((c) => ({ id: c, name: name(c) }))}
          products={products}
          companyMarginF={ctx.companyMarginF}
          correctionNote={status === "correction_requested" ? (dfr.correction_note as string) : null}
        />
      </>
    );
  }

  const pick = Number(sp.v);
  const shown = versions.find((v) => v.version_number === pick) ?? versions[0];
  return (
    <>
      {header}
      <div className="space-y-4">
        <section aria-label={t("statusLabel")} className={`rounded-2xl border-l-8 p-4 ${status === "accepted" ? "border-green-700 bg-green-50" : status === "correction_requested" ? "border-red-700 bg-red-50" : status === "submitted" ? "border-brand-600 bg-brand-50" : "border-neutral-400 bg-white"}`}>
          <p className="text-lg font-bold">{t(`statuses.${status}`)}</p>
          {shown && <p>{t("submittedBy", { name: name(shown.submitted_by), when: when(shown.submitted_at), version: shown.version_number })}</p>}
          {status === "accepted" && dfr.accepted_at && <p>{t("acceptedBy", { name: name(dfr.accepted_by as string), when: when(dfr.accepted_at as string) })}</p>}
          {status === "correction_requested" && <p>{t("correctionBy", { name: name(dfr.correction_by as string), note: dfr.correction_note as string })}</p>}
          {status === "correction_requested" && office && canWrite && (
            <Link href={`/jobs/${id}/reports/${date}?edit=1`} className={`${buttonClasses("secondary", "md")} mt-2`}>
              {t("editYourself")}
            </Link>
          )}
          {status === "draft" && <p>{t(reopens.length ? "reopen.draftAfterReopen" : "draftOnly")}</p>}
          {reopens.length > 0 && (
            <ul aria-label={t("reopen.historyLabel")} className="mt-2 space-y-1 text-sm">
              {reopens.map((r, i) => (
                <li key={i}>
                  {t("reopen.historyLine", { name: name(r.reopened_by), when: when(r.reopened_at), reason: r.reason, version: r.accepted_version, acceptedBy: name(r.accepted_by) })}
                </li>
              ))}
            </ul>
          )}
        </section>
        {status === "submitted" && canAccessManagement(profile.role) && <ReviewBox id={dfr.id as string} />}
        {status === "accepted" && office && canWrite && <ReopenBox id={dfr.id as string} />}
        {shown ? <DfrView content={shown.content} /> : null}
        {versions.length > 1 && (
          <nav aria-label={t("versions")} className="flex flex-wrap gap-2 text-sm">
            <span className="font-semibold">{t("versions")}:</span>
            {versions.map((v) => (
              <Link key={v.version_number} href={`?v=${v.version_number}`} aria-current={v === shown ? "page" : undefined} className={`underline ${v === shown ? "font-bold" : ""}`}>
                {t("versionN", { n: v.version_number, when: when(v.submitted_at) })}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </>
  );
}
