import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { ClearOfflineDataOnMount } from "@/components/offline/clear-offline-data-on-mount";
import { Alert } from "@/components/ui/alert";
import { getProfile } from "@/lib/auth/dal";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { LoginForm } from "./login-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const t = await getTranslations();
  const { reason } = await searchParams;
  if (!isSupabaseConfigured()) return <Alert tone="warning">{t("common.notConfigured")}</Alert>;
  if (await getProfile()) redirect("/");
  return (
    <div className="space-y-5">
      <ClearOfflineDataOnMount />
      <h1 className="text-2xl font-bold">{t("auth.signInTitle")}</h1>
      {reason === "link-invalid" && <Alert tone="error">{t("auth.linkInvalid")}</Alert>}
      {reason === "no-access" && <Alert tone="error">{t("auth.noAccess")}</Alert>}
      <LoginForm />
    </div>
  );
}
