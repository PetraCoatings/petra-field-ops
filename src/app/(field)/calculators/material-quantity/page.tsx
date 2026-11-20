import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { MaterialQuantityCalculator } from "./material-quantity-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calculators.materialQuantity");
  return { title: t("title") };
}

export default async function MaterialQuantityPage() {
  await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <PageHeader title={t("calculators.materialQuantity.title")} backHref="/calculators" backLabel={t("home.modules.calculators")} />
      <MaterialQuantityCalculator />
    </>
  );
}
