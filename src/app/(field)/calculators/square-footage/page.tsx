import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { SquareFootageCalculator } from "./square-footage-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calculators.squareFootage");
  return { title: t("title") };
}

export default async function SquareFootagePage() {
  await requireProfile();
  const t = await getTranslations();
  return (
    <>
      <PageHeader
        title={t("calculators.squareFootage.title")}
        backHref="/calculators"
        backLabel={t("home.modules.calculators")}
      />
      <SquareFootageCalculator />
    </>
  );
}
