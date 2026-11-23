import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPasswordForm } from "./set-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("setPasswordTitle") };
}

/** Reached from an invitation or reset email (after /auth/confirm signs the person in). */
export default async function SetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login?reason=link-invalid");
  // With two-step sign-in set up, Supabase needs the code before a password change.
  if (data.claims.aal !== "aal2") {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    if (factors?.totp?.some((f) => f.status === "verified")) redirect("/two-step?next=/set-password");
  }
  const t = await getTranslations("auth");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{t("setPasswordTitle")}</h1>
      <SetPasswordForm />
    </div>
  );
}
