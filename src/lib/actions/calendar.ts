"use server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireProfile, requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { type FormState } from "@/lib/forms/form-state";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host}`;
}

export type LinkResult = { ok: true; url: string } | { ok: false };

/** Make (or replace) my private calendar link. The old link stops working. */
export async function newCalendarLink(scope: "mine" | "all"): Promise<LinkResult> {
  await requireProfile();
  if (scope !== "mine" && scope !== "all") return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("new_calendar_feed", { p_scope: scope });
  if (error || typeof data !== "string") return { ok: false };
  revalidatePath("/calendar");
  return { ok: true, url: `${await origin()}/calendar-feed/${data}.ics` };
}

/** Turn off my calendar link (or, for office admins, someone else's). */
export async function revokeCalendarLink(employeeId?: string): Promise<{ ok: boolean }> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc("revoke_calendar_feed", { p_employee_id: employeeId ?? null });
  revalidatePath("/calendar");
  return { ok: !error };
}

export async function addHoliday(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("office_admin");
  const parsed = z
    .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), name: z.string().trim().min(1).max(80), paid: z.boolean() })
    .safeParse({ date: fd.get("date"), name: fd.get("name"), paid: fd.get("paid") === "on" });
  if (!parsed.success) return { status: "error", message: "calendar.holidays.invalid" };
  const supabase = await createClient();
  const { error } = await supabase.from("holidays").insert({ date: parsed.data.date, name: parsed.data.name, is_paid: parsed.data.paid });
  if (error) return { status: "error", message: error.code === "23505" ? "calendar.holidays.duplicate" : "common.genericError" };
  revalidatePath("/calendar");
  return { status: "success", message: "calendar.holidays.added" };
}

export async function deleteHoliday(fd: FormData): Promise<void> {
  await requireRole("office_admin");
  const date = String(fd.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const supabase = await createClient();
  await supabase.from("holidays").delete().eq("date", date);
  revalidatePath("/calendar");
}
