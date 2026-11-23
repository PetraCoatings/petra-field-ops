"use server";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { PAYROLL_ENGINE_VERSION } from "@/domain/payroll/engine";
import { loadPayroll, snapshotLines } from "@/lib/payroll/load";

export type MarkResult = { ok: true } | { ok: false; error: "blocked" | "already" | "changed" | "reason" | "generic" };

/**
 * "Mark as entered in Gusto": recomputes the period on the server (never
 * trusting numbers from the browser), refuses if anything blocks it or if the
 * numbers changed since the page was shown, then saves the permanent snapshot.
 */
export async function markEntered(payload: { period: string; inputHash: string; replaceReason?: string }): Promise<MarkResult> {
  await requireRole("office_admin");
  if (typeof payload?.period !== "string" || typeof payload.inputHash !== "string") return { ok: false, error: "generic" };
  const p = await loadPayroll(payload.period);
  if (p.blockers.length > 0) return { ok: false, error: "blocked" };
  if (p.inputHash !== payload.inputHash) return { ok: false, error: "changed" };
  const active = p.runs.find((r) => !r.voidedAt);
  if (active && !(payload.replaceReason && payload.replaceReason.trim().length >= 3)) return { ok: false, error: active ? "reason" : "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payroll_run", {
    p_period_start: p.period.start,
    p_period_end: p.period.end,
    p_engine_version: PAYROLL_ENGINE_VERSION,
    p_input_hash: p.inputHash,
    p_lines: snapshotLines(p),
    p_replace_reason: active ? payload.replaceReason!.trim() : null,
  });
  if (error) return { ok: false, error: /already marked/.test(error.message) ? "already" : /approved/.test(error.message) ? "blocked" : "generic" };
  revalidatePath("/manage/payroll");
  return { ok: true };
}
