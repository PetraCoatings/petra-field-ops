"use server";
import { revalidatePath } from "next/cache";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { runClockPress, type ClockErrorCode, type ClockOutcome, type ClockPressInput } from "@/lib/time/clock-core";

export type ClockPress = ClockPressInput;
export type ClockError = ClockErrorCode;
export type ClockResult = ClockOutcome;

/** One Time Clock press (see lib/time/clock-core.ts). Phones queue presses made without signal and send them to /api/sync/clock. */
export async function clockPress(payload: ClockPress): Promise<ClockResult> {
  await requireProfile();
  const r = await runClockPress(await createClient(), payload);
  if (r.ok) {
    revalidatePath("/time-clock");
    revalidatePath("/time-clock/crew");
  }
  return r;
}
