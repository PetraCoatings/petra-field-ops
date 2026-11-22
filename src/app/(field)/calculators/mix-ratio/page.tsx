import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { pickerProducts } from "@/lib/library/picker-products";
import { MixRatioCalculator } from "./mix-ratio-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calculators.mixRatio");
  return { title: t("title") };
}

export default async function MixRatioPage() {
  await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("calculators.mixRatio.title")} backHref="/calculators" backLabel={t("home.modules.calculators")} />
      <MixRatioCalculator products={await pickerProducts()} />
    </>
  );
}
