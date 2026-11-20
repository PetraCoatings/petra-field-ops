import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { SpreadRateCalculator } from "./spread-rate-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calculators.spreadRate");
  return { title: t("title") };
}

export default async function SpreadRatePage() {
  await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("calculators.spreadRate.title")} backHref="/calculators" backLabel={t("home.modules.calculators")} />
      <SpreadRateCalculator />
    </>
  );
}
