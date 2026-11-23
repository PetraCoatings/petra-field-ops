import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClasses } from "@/components/ui/button-styles";
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
      {["crew_lead", "project_manager", "office_admin"].includes(profile.role) && (
        <Link href="/time-clock/crew" className={`${buttonClasses("secondary", "lg")} mb-4 w-full`}>
          <Users aria-hidden className="size-6" />
          {t("timeClock.crew.link")}
        </Link>
      )}
      <TimeClock segments={segments} jobs={jobs} settings={settings} serverNow={serverNow()} />
    </>
  );
}
