"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

/**
 * One Time Clock button press. The database (public.clock_action) checks the
 * order of actions and records who pressed it; this only validates the shape.
 * `id` is made on the phone once per press, so retrying after a dropped
 * connection can never record the press twice.
 */
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const pressSchema = z.object({
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
export type ClockPress = z.infer<typeof pressSchema>;

export type ClockError =
  | "not_clocked_in"
  | "already_clocked_in"
  | "on_lunch"
  | "not_on_lunch"
  | "no_change"
  | "category_required"
  | "before_last_entry"
  | "inactive"
  | "invalid"
  | "forbidden"
  | "generic";
export type ClockResult = { ok: true; results: { employeeId: string; ok: boolean; error?: ClockError }[] } | { ok: false; error: ClockError };

export async function clockPress(payload: ClockPress): Promise<ClockResult> {
  await requireProfile();
  const parsed = pressSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const p = parsed.data;
  const supabase = await createClient();
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
  revalidatePath("/time-clock");
  revalidatePath("/time-clock/crew");
  const results = (data as { employee_id: string; ok: boolean; error?: ClockError }[]).map((r) => ({
    employeeId: r.employee_id,
    ok: r.ok,
    ...(r.error ? { error: r.error } : {}),
  }));
  return { ok: true, results };
}
