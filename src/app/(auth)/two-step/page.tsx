import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getProfile } from "@/lib/auth/dal";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";
import { TwoStepForm } from "./two-step-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("twoStep");
  return { title: t("title") };
}

/**
 * Two-step sign-in: after the password, a 6-digit code from an authenticator
 * app. Required for office admins (they're sent here until it's done);
 * the first visit sets it up with a QR code.
 */
export default async function TwoStepPage({ searchParams }: PageProps<"/two-step">) {
  const { next: rawNext } = await searchParams;
  const next = safeNextPath(typeof rawNext === "string" ? rawNext : null, "/");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect("/login");
  if (data.claims.aal === "aal2") redirect(next);
  const [profile, { data: factors }] = await Promise.all([getProfile(), supabase.auth.mfa.listFactors()]);
  if (!profile) redirect("/login?reason=no-access");
  const factor = factors?.totp?.find((f) => f.status === "verified") ?? null;
  const t = await getTranslations("twoStep");
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">{factor ? t("title") : t("setupTitle")}</h1>
      <TwoStepForm mode={factor ? "verify" : "enroll"} factorId={factor?.id ?? null} required={profile.role === "office_admin"} next={next} />
    </div>
  );
}
