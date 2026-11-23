import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { clockSettings } from "@/lib/time/my-time";
import { MyPayRates } from "./my-pay-rates";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payRates");
  return { title: t("myTitle") };
}

/** My Pay Rates: hidden until the person re-enters their password; hides itself again. */
export default async function MyPayRatesPage() {
  await requireProfile();
  const t = await getTranslations();
  const settings = await clockSettings();
  return (
    <>
      <PageHeader title={t("payRates.myTitle")} backHref="/time-clock/timesheet" backLabel={t("timeClock.sheet.title")} />
      <MyPayRates tz={settings.timezone} />
    </>
  );
}
