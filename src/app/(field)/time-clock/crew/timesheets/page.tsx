import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { WeekList } from "@/components/time-clock/week-list";
import { requireRole } from "@/lib/auth/dal";
import { clockSettings, crewData, serverNow } from "@/lib/time/my-time";
import { loadWeekRows, weekParam } from "@/lib/time/timesheet";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeClock.sheet");
  return { title: t("crewList") };
}

/** A crew lead's crew for the week: review, fix and submit each person's timesheet. */
export default async function CrewTimesheetsPage({ searchParams }: PageProps<"/time-clock/crew/timesheets">) {
  const profile = await requireRole("crew_lead", "office_admin");
  const sp = await searchParams;
  const t = await getTranslations();
  const settings = await clockSettings();
  const weekOf = weekParam(sp.week, settings.timezone);
  // Everyone on the lead's jobs is listed, even with no time yet this week.
  const crew = await crewData();
  const mine = Object.values(crew.crews).filter((ids) => ids.includes(profile.employeeId)).flat();
  const { rows, weekStart, weekEnd } = await loadWeekRows(weekOf, settings, [...new Set([profile.employeeId, ...mine])]);
  return (
    <>
      <PageHeader title={t("timeClock.sheet.crewList")} backHref="/time-clock" backLabel={t("home.modules.timeClock")} />
      <p className="mb-3 text-base text-neutral-700">{t("timeClock.sheet.crewIntro")}</p>
      <WeekList
        rows={rows}
        weekStart={weekStart}
        weekEnd={weekEnd}
        tz={settings.timezone}
        now={serverNow()}
        personHref={(id, week) => (id === profile.employeeId ? `/time-clock/timesheet?week=${week}` : `/time-clock/timesheet?employee=${id}&week=${week}`)}
        weekHref={(week) => `/time-clock/crew/timesheets?week=${week}`}
      />
    </>
  );
}
