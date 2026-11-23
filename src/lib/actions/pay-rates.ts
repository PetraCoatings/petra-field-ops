"use server";
import { revalidatePath } from "next/cache";
import { createClient as createPlainClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireProfile, requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { supabasePublishableKey, supabaseUrl } from "@/lib/supabase/env";
import { type FormState } from "@/lib/forms/form-state";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

/** Office admin: add a rate (a raise is a new rate with a later start date). */
export async function addPayRate(employeeId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("office_admin");
  const parsed = z
    .object({
      category: z.enum(["job", "drive", "ride"]),
      rate: z.string().trim().regex(/^\$?\d{1,3}(\.\d{1,2})?$/),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      note: z.string().trim().max(200),
    })
    .safeParse({ category: fd.get("category"), rate: fd.get("rate"), from: fd.get("effective_from"), note: fd.get("note") ?? "" });
  if (!uuid.safeParse(employeeId).success || !parsed.success) {
    const field = parsed.success ? undefined : String(parsed.error.issues[0]?.path[0]);
    return { status: "error", fieldErrors: field === "rate" ? { rate: "payRates.errors.rate" } : field === "from" ? { effective_from: "payRates.errors.date" } : undefined, message: field ? undefined : "common.genericError" };
  }
  const { category, rate, from, note } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("pay_rates").insert({
    employee_id: employeeId,
    category,
    hourly_rate: Number(rate.replace("$", "")),
    effective_from: from,
    note: note || null,
  });
  if (error) return { status: "error", message: error.code === "23505" ? "payRates.errors.duplicate" : error.code === "23514" ? "payRates.errors.rate" : "common.genericError" };
  revalidatePath(`/manage/employees/${employeeId}`);
  return { status: "success", message: "payRates.added" };
}

/** Office admin: remove a rate entered by mistake (the audit log keeps it). */
export async function deletePayRate(fd: FormData): Promise<void> {
  await requireRole("office_admin");
  const id = String(fd.get("id"));
  const employeeId = String(fd.get("employeeId"));
  if (!uuid.safeParse(id).success || !uuid.safeParse(employeeId).success) return;
  const supabase = await createClient();
  await supabase.from("pay_rates").delete().eq("id", id);
  revalidatePath(`/manage/employees/${employeeId}`);
}

export type MyRates = { category: "job" | "drive" | "ride"; rate: number; effectiveFrom: string }[];
export type RevealResult = { ok: true; rates: MyRates } | { ok: false; error: "password" | "generic" };

/**
 * "My Pay Rates": the person re-enters their password, and only then are
 * their own rates sent to the phone (owner decision Q10). The password is
 * checked with a separate, throwaway sign-in that is signed out right away;
 * the person's own session isn't touched.
 */
export async function revealMyRates(password: string): Promise<RevealResult> {
  const profile = await requireProfile();
  if (typeof password !== "string" || password.length === 0 || password.length > 200) return { ok: false, error: "password" };
  const supabase = await createClient();
  const { data: me } = await supabase.auth.getUser();
  const email = me.user?.email;
  if (!email) return { ok: false, error: "generic" };
  const check = createPlainClient(supabaseUrl(), supabasePublishableKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await check.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: "password" };
  await check.auth.signOut({ scope: "local" });
  const { data, error: readError } = await supabase.from("pay_rates").select("category, hourly_rate, effective_from").eq("employee_id", profile.employeeId).order("effective_from");
  if (readError) return { ok: false, error: "generic" };
  return {
    ok: true,
    rates: (data ?? []).map((r) => ({ category: r.category as MyRates[number]["category"], rate: Number(r.hourly_rate), effectiveFrom: r.effective_from as string })),
  };
}
