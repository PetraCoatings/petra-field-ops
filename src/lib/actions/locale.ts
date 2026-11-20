"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, toLocale } from "@/i18n/locales";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Switch language on this device, and save it to the employee's profile if signed in. */
export async function setLocale(formData: FormData) {
  const locale = toLocale(String(formData.get("locale") ?? ""));
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) await supabase.rpc("set_my_locale", { p_locale: locale });
  }
  revalidatePath("/", "layout");
}
