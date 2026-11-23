import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { CrewClock } from "@/components/time-clock/crew-clock";
import { requireRole } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { clockJobs, clockSettings, crewData, serverNow } from "@/lib/time/my-time";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("timeClock.crew");
  return { title: t("title") };
}

/** Crew clock-in: a crew lead (or the office) clocks several people at once. */
export default async function CrewClockPage() {
  const profile = await requireRole("crew_lead", "office_admin");
  const t = await getTranslations();
  const [settings, jobs, crew] = await Promise.all([clockSettings(), clockJobs(canAccessManagement(profile.role)), crewData()]);
  return (
    <>
      <PageHeader title={t("timeClock.crew.title")} backHref="/time-clock" backLabel={t("home.modules.timeClock")} />
      <CrewClock me={profile.employeeId} jobs={jobs} settings={settings} {...crew} serverNow={serverNow()} />
    </>
  );
}
