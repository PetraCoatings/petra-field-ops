import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ComingSoon } from "@/components/coming-soon";
import { requireProfile } from "@/lib/auth/dal";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("productData") };
}

export default async function Page() {
  await requireProfile();
  return <ComingSoon module="productData" phase={4} />;
}
