import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { Timesheet } from "@/components/time-clock/timesheet";
import { requireProfile } from "@/lib/auth/dal";
import { localDate } from "@/domain/time/zoned";
import { clockJobs, clockSettings, serverNow } from "@/lib/time/my-time";
import { loadSheet, selfEditWindowHours, weekParam } from "@/lib/time/timesheet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeClock.sheet");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** My timesheet, or (for a crew lead or office admin) a crew member's. */
export default async function TimesheetPage({ searchParams }: PageProps<"/time-clock/timesheet">) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const other = typeof sp.employee === "string" && UUID.test(sp.employee) && sp.employee !== profile.employeeId ? sp.employee : null;
  if (other && profile.role === "installer") redirect("/time-clock/timesheet");
  const t = await getTranslations();
  const settings = await clockSettings();
  const weekOf = weekParam(sp.week, settings.timezone);
  const [sheet, jobs, windowHours] = await Promise.all([
    loadSheet(other ?? profile.employeeId, weekOf, settings),
    clockJobs(profile.role === "office_admin" || profile.role === "project_manager"),
    selfEditWindowHours(),
  ]);
  if (!sheet) notFound();
  const back = other ? `/time-clock/crew/timesheets?week=${localDate(sheet.weekStart, settings.timezone)}` : "/time-clock";
  return (
    <>
      <PageHeader
        title={other ? t("timeClock.sheet.crewTitle", { name: sheet.employeeName }) : t("timeClock.sheet.title")}
        backHref={back}
        backLabel={other ? t("timeClock.sheet.crewList") : t("home.modules.timeClock")}
      />
      <Timesheet
        sheet={sheet}
        jobs={jobs}
        settings={settings}
        viewer={{ id: profile.employeeId, role: profile.role }}
        windowHours={windowHours}
        serverNow={serverNow()}
        basePath="/time-clock/timesheet"
      />
    </>
  );
}
