import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotForm } from "./forgot-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("forgotTitle") };
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("forgotTitle")}</h1>
      <p className="text-base text-neutral-700">{t("forgotHelp")}</p>
      <ForgotForm />
    </div>
  );
}
