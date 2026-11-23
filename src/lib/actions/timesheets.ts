"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { zonedTimeToInstant } from "@/domain/time/zoned";

/**
 * Timesheet actions. The database functions decide who may do what (own time
 * within 24 hours, a crew lead's crew in open weeks, office admins until a
 * week is approved); these validate the shape and turn errors into messages.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
const weekOf = z.number().int().positive();

export type SheetError = "too_late" | "submitted" | "locked" | "overlap" | "reason" | "end_before_start" | "future" | "end_required" | "gone" | "forbidden" | "open_entries" | "invalid" | "generic";
export type SheetResult = { ok: true } | { ok: false; error: SheetError };

function toError(e: { code?: string; message?: string }): SheetError {
  const m = e.message ?? "";
  if (/approved and locked/.test(m)) return "locked";
  if (/Too late/.test(m)) return "too_late";
  if (/already submitted/.test(m)) return "submitted";
  if (/overlaps/.test(m) || e.code === "23P01") return "overlap";
  if (/reason/i.test(m)) return "reason";
  if (/before the start/.test(m)) return "end_before_start";
  if (/future/.test(m)) return "future";
  if (/end time is required/.test(m)) return "end_required";
  if (/missing clock-out/.test(m)) return "open_entries";
  if (e.code === "P0002") return "gone";
  if (e.code === "42501") return "forbidden";
  if (e.code === "22023") return "invalid";
  return "generic";
}

async function settingsTz(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.from("app_settings").select("company_timezone").single();
  return (data?.company_timezone as string) || "America/Chicago";
}
function fromLocal(v: string, tz: string): string {
  const [d, t] = v.split("T");
  const [y, mo, da] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return new Date(zonedTimeToInstant(y, mo, da, h, mi, tz)).toISOString();
}
function done(): SheetResult {
  revalidatePath("/", "layout");
  return { ok: true };
}

const correctionSchema = z.object({
  segmentId: uuid.nullable(),
  employeeId: uuid.nullable(),
  start: local.nullable(),
  end: local.nullable(),
  kind: z.enum(["work", "lunch"]),
  category: z.enum(["job", "drive", "ride"]).nullable(),
  projectId: uuid.nullable(),
  reason: z.string().trim().min(3).max(500),
  remove: z.boolean(),
});

export async function correctTime(payload: z.input<typeof correctionSchema>): Promise<SheetResult> {
  await requireProfile();
  const parsed = correctionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.some((i) => i.path[0] === "reason") ? "reason" : "invalid" };
  const p = parsed.data;
  const tz = await settingsTz();
  const supabase = await createClient();
  const { error } = await supabase.rpc("correct_time", {
    p_segment_id: p.segmentId,
    p_reason: p.reason,
    p_start: p.remove || !p.start ? null : fromLocal(p.start, tz),
    p_end: p.remove || !p.end ? null : fromLocal(p.end, tz),
    p_kind: p.kind,
    p_category: p.category,
    p_project_id: p.projectId,
    p_void: p.remove,
    p_employee_id: p.employeeId,
  });
  return error ? { ok: false, error: toError(error) } : done();
}

export async function requestTimeChange(payload: { weekOf: number; message: string; segmentId?: string | null }): Promise<SheetResult> {
  await requireProfile();
  const parsed = z.object({ weekOf, message: z.string().trim().min(3).max(1000), segmentId: uuid.nullable().optional() }).safeParse(payload);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_time_change", {
    p_week_of: new Date(parsed.data.weekOf).toISOString(),
    p_message: parsed.data.message,
    p_segment_id: parsed.data.segmentId ?? null,
  });
  return error ? { ok: false, error: toError(error) } : done();
}

export async function resolveTimeChange(payload: { id: string; note: string }): Promise<SheetResult> {
  await requireProfile();
  const parsed = z.object({ id: uuid, note: z.string().max(500) }).safeParse(payload);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_time_change", { p_request_id: parsed.data.id, p_note: parsed.data.note });
  return error ? { ok: false, error: toError(error) } : done();
}

const weekAction = z.object({ employeeId: uuid, weekOf });

export async function setWeekStatus(payload: { employeeId: string; weekOf: number; to: "submitted" | "approved" | "open"; reason?: string }): Promise<SheetResult> {
  await requireProfile();
  const parsed = weekAction.extend({ to: z.enum(["submitted", "approved", "open"]), reason: z.string().optional() }).safeParse(payload);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { employeeId, to, reason } = parsed.data;
  const week = new Date(parsed.data.weekOf).toISOString();
  const supabase = await createClient();
  const { error } =
    to === "submitted"
      ? await supabase.rpc("submit_timesheet", { p_employee_id: employeeId, p_week_of: week })
      : to === "approved"
        ? await supabase.rpc("approve_timesheet", { p_employee_id: employeeId, p_week_of: week })
        : await supabase.rpc("reopen_timesheet", { p_employee_id: employeeId, p_week_of: week, p_reason: reason ?? "" });
  return error ? { ok: false, error: toError(error) } : done();
}
