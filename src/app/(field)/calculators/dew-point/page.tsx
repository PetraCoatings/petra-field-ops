import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { DEFAULT_DEW_POINT_MARGIN_F } from "@/domain/calculators/dew-point";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { DewPointCalculator } from "./dew-point-calculator";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("calculators.dewPoint");
  return { title: t("title") };
}

/** Company default margin (Management → Settings). Falls back to 5 °F if it can't be read. */
async function companyMarginF(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("dew_point_margin_f").single();
  const margin = Number(data?.dew_point_margin_f);
  return Number.isFinite(margin) && margin >= 0 ? margin : DEFAULT_DEW_POINT_MARGIN_F;
}

export default async function DewPointPage() {
  await requireProfile();
  const [t, marginF] = await Promise.all([getTranslations(), companyMarginF()]);
  return (
    <>
      <PageHeader title={t("calculators.dewPoint.title")} backHref="/calculators" backLabel={t("home.modules.calculators")} />
      <DewPointCalculator marginF={marginF} />
    </>
  );
}
