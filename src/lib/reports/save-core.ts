import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeReport, type DfrContent } from "@/domain/reports/dfr";
import { reportContext } from "@/lib/reports/context";

export type SaveCoreResult =
  | { ok: true; version: number; content: DfrContent; submittedVersion?: number }
  | { ok: false; error: "conflict"; server: { content: unknown; version: number; savedBy: string | null; savedAt: string } }
  | { ok: false; error: "invalid"; path: string }
  | { ok: false; error: "submitted" | "empty" | "forbidden" | "generic" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Save a daily report draft (and optionally submit it), recomputing dew
 * points and spread rates on the server. `basedOn` is the draft version the
 * phone started from: if someone else saved since, nothing is overwritten and
 * their copy comes back. Used by the page and by the phone's offline queue.
 */
export async function saveReportCore(
  supabase: SupabaseClient,
  payload: { id: unknown; content: unknown; basedOn: unknown; submit?: unknown },
): Promise<SaveCoreResult> {
  if (typeof payload?.id !== "string" || !UUID.test(payload.id) || !Number.isInteger(payload.basedOn)) return { ok: false, error: "generic" };
  const computed = computeReport(payload.content, await reportContext());
  if (!computed.ok) return { ok: false, error: "invalid", path: computed.path };
  const { data: version, error } = await supabase.rpc("save_daily_report", { p_id: payload.id, p_content: computed.content, p_based_on: payload.basedOn });
  if (error) return failure(supabase, error, payload.id);
  let submittedVersion: number | undefined;
  if (payload.submit === true) {
    const { data: v, error: e2 } = await supabase.rpc("submit_daily_report", { p_id: payload.id, p_based_on: version as number });
    if (e2) return failure(supabase, e2, payload.id);
    submittedVersion = v as number;
  }
  return { ok: true, version: version as number, content: computed.content, submittedVersion };
}

async function failure(supabase: SupabaseClient, e: { code?: string; message?: string }, id: string): Promise<SaveCoreResult> {
  if (/version_conflict/.test(e.message ?? "")) {
    const { data } = await supabase.from("daily_field_reports").select("draft, version, draft_saved_by, draft_saved_at").eq("id", id).single();
    const { data: who } = data?.draft_saved_by ? await supabase.from("employee_directory").select("display_name").eq("id", data.draft_saved_by).maybeSingle() : { data: null };
    return { ok: false, error: "conflict", server: { content: data?.draft ?? {}, version: (data?.version as number) ?? 0, savedBy: (who?.display_name as string | undefined) ?? null, savedAt: (data?.draft_saved_at as string) ?? "" } };
  }
  if (/already submitted/.test(e.message ?? "")) return { ok: false, error: "submitted" };
  if (/empty/.test(e.message ?? "")) return { ok: false, error: "empty" };
  if (e.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "generic" };
}
