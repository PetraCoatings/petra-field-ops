"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { LOCALE_COOKIE } from "@/i18n/locales";
import { createClient } from "@/lib/supabase/server";
import { type FormState, isEmail, str } from "@/lib/forms/form-state";

const COOKIE_OPTS = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };

async function siteOrigin(): Promise<string> {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = str(formData, "email");
  const password = formData.get("password");
  if (!isEmail(email) || typeof password !== "string" || password.length === 0) {
    return { status: "error", message: "auth.invalidCredentials" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email!, password });
  if (error) return { status: "error", message: "auth.invalidCredentials" };

  // A valid password is not enough: the person must be an ACTIVE employee.
  const { data: profile } = await supabase
    .rpc("get_my_profile")
    .maybeSingle<{ preferred_locale: "en" | "es" }>();
  if (!profile) {
    await supabase.auth.signOut();
    return { status: "error", message: "auth.noAccess" };
  }
  (await cookies()).set(LOCALE_COOKIE, profile.preferred_locale, COOKIE_OPTS);
  redirect("/");
}

export async function requestPasswordReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = str(formData, "email");
  if (!isEmail(email)) return { status: "error", fieldErrors: { email: "validation.email" } };
  const supabase = await createClient();
  // Always report success so the form can't be used to discover which emails have accounts.
  await supabase.auth.resetPasswordForEmail(email!, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/set-password`,
  });
  return { status: "success", message: "auth.resetSent" };
}

export async function setPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  if (typeof password !== "string" || password.length < 10 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
    return { status: "error", fieldErrors: { password: "auth.passwordTooWeak" } };
  }
  if (password !== confirm) return { status: "error", fieldErrors: { confirm: "auth.passwordMismatch" } };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return error.code === "weak_password"
      ? { status: "error", fieldErrors: { password: "auth.passwordTooWeak" } }
      : { status: "error", message: "auth.linkInvalid" };
  }
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
