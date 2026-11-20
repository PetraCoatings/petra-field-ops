"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { type FormState, bool, decimalString, str } from "@/lib/forms/form-state";
import { createClient } from "@/lib/supabase/server";

export async function updateSettings(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireRole("office_admin");
  const errors: Record<string, string> = {};
  const dow = Number(str(fd, "workweek_start_dow"));
  if (!Number.isInteger(dow) || dow < 1 || dow > 7) errors.workweek_start_dow = "validation.required";
  const time = str(fd, "workweek_start_time");
  if (!time || !/^\d{2}:\d{2}$/.test(time)) errors.workweek_start_time = "validation.required";
  const windowHours = Number(str(fd, "self_edit_window_hours"));
  if (!Number.isInteger(windowHours) || windowHours < 0 || windowHours > 168) {
    errors.self_edit_window_hours = "validation.number";
  }
  const margin = decimalString(str(fd, "dew_point_margin_f"));
  if (margin === null || margin === "invalid") errors.dew_point_margin_f = "validation.number";
  if (Object.keys(errors).length) return { status: "error", fieldErrors: errors };

  const supabase = await createClient();
  const { error } = await supabase
    .from("app_settings")
    .update({
      workweek_start_dow: dow,
      workweek_start_time: time,
      self_edit_window_hours: windowHours,
      gps_on_category_switch: bool(fd, "gps_on_category_switch"),
      dew_point_margin_f: margin,
    })
    .eq("id", true);
  if (error) return { status: "error", message: "common.genericError" };
  revalidatePath("/manage/settings");
  return { status: "success", message: "common.saved" };
}
