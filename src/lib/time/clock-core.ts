import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One Time Clock button press, as sent by the phone (right away, or later
 * from the phone's "send when there's signal" queue). The database
 * (public.clock_action) checks the order of actions and records who pressed
 * it; `id` is made on the phone once per press, so sending it twice can never
 * record it twice, and `deviceTs` is when it was pressed.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export const pressSchema = z.object({
  id: uuid,
  action: z.enum(["clock_in", "switch", "break_start", "break_end", "clock_out"]),
  category: z.enum(["job", "drive", "ride"]).nullable().optional(),
  projectId: uuid.nullable().optional(),
  deviceTs: z.string().datetime({ offset: true }),
  deviceNow: z.string().datetime({ offset: true }),
  gps: z.discriminatedUnion("status", [
    z.object({ status: z.literal("captured"), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(1e6) }),
    z.object({ status: z.enum(["denied", "unavailable", "timeout", "not_requested"]) }),
  ]),
  employeeIds: z.array(uuid).min(1).max(50).optional(),
});
export type ClockPressInput = z.infer<typeof pressSchema>;

export type ClockErrorCode =
  | "not_clocked_in"
  | "already_clocked_in"
  | "on_lunch"
  | "not_on_lunch"
  | "no_change"
  | "category_required"
  | "before_last_entry"
  | "too_late"
  | "inactive"
  | "invalid"
  | "forbidden"
  | "generic";
export type ClockOutcome = { ok: true; results: { employeeId: string; ok: boolean; error?: ClockErrorCode }[] } | { ok: false; error: ClockErrorCode };

export async function runClockPress(supabase: SupabaseClient, payload: unknown): Promise<ClockOutcome> {
  const parsed = pressSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const p = parsed.data;
  const { data, error } = await supabase.rpc("clock_action", {
    p_client_event_id: p.id,
    p_action: p.action,
    p_device_ts: p.deviceTs,
    p_gps_status: p.gps.status,
    p_category: p.category ?? null,
    p_project_id: p.projectId ?? null,
    p_gps_lat: p.gps.status === "captured" ? p.gps.lat : null,
    p_gps_lng: p.gps.status === "captured" ? p.gps.lng : null,
    p_gps_accuracy_m: p.gps.status === "captured" ? p.gps.accuracy : null,
    p_employee_ids: p.employeeIds ?? null,
    p_device_now: p.deviceNow,
  });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : error.code === "22023" ? "invalid" : "generic" };
  return {
    ok: true,
    results: (data as { employee_id: string; ok: boolean; error?: ClockErrorCode }[]).map((r) => ({ employeeId: r.employee_id, ok: r.ok, ...(r.error ? { error: r.error } : {}) })),
  };
}
