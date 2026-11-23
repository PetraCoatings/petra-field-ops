import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { TimeClock } from "@/components/time-clock/time-clock";
import { requireProfile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { clockJobs, clockSettings, mySegments, serverNow } from "@/lib/time/my-time";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("timeClock") };
}

export default async function TimeClockPage() {
  const profile = await requireProfile();
  const t = await getTranslations();
  const settings = await clockSettings();
  const [segments, jobs] = await Promise.all([mySegments(profile.employeeId, settings), clockJobs(canAccessManagement(profile.role))]);
  return (
    <>
      <PageHeader title={t("home.modules.timeClock")} backHref="/" backLabel={t("common.home")} />
      <TimeClock segments={segments} jobs={jobs} settings={settings} serverNow={serverNow()} />
    </>
  );
}
