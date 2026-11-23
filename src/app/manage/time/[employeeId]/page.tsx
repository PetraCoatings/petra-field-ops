import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { Timesheet } from "@/components/time-clock/timesheet";
import { requireManagePath } from "@/lib/auth/dal";
import { localDate } from "@/domain/time/zoned";
import { clockJobs, clockSettings, serverNow } from "@/lib/time/my-time";
import { loadSheet, selfEditWindowHours, weekParam } from "@/lib/time/timesheet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeClock.sheet");
  return { title: t("title") };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ManageTimesheetPage({ params, searchParams }: PageProps<"/manage/time/[employeeId]">) {
  const profile = await requireManagePath("/manage/time");
  const { employeeId } = await params;
  if (!UUID.test(employeeId)) notFound();
  const sp = await searchParams;
  const t = await getTranslations();
  const settings = await clockSettings();
  const [sheet, jobs, windowHours] = await Promise.all([
    loadSheet(employeeId, weekParam(sp.week, settings.timezone), settings),
    clockJobs(true),
    selfEditWindowHours(),
  ]);
  if (!sheet) notFound();
  return (
    <>
      <PageHeader
        title={t("timeClock.sheet.crewTitle", { name: sheet.employeeName })}
        backHref={`/manage/time?week=${localDate(sheet.weekStart, settings.timezone)}`}
        backLabel={t("manage.nav.time")}
      />
      <div className="max-w-3xl">
        <Timesheet
          sheet={sheet}
          jobs={jobs}
          settings={settings}
          viewer={{ id: profile.employeeId, role: profile.role }}
          windowHours={windowHours}
          serverNow={serverNow()}
          basePath={`/manage/time/${employeeId}`}
        />
      </div>
    </>
  );
}
