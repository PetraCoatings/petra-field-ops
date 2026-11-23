"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { computeReport, type DfrContent } from "@/domain/reports/dfr";
import { reportContext } from "@/lib/reports/context";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** Form action: open (or start) the report for a job and day. */
export async function openDailyReport(fd: FormData): Promise<void> {
  await requireProfile();
  const project = uuid.safeParse(fd.get("projectId"));
  const day = date.safeParse(fd.get("date"));
  if (!project.success || !day.success) return;
  const supabase = await createClient();
  await supabase.rpc("ensure_daily_report", { p_project_id: project.data, p_date: day.data });
  redirect(`/jobs/${project.data}/reports/${day.data}`);
}

export type SaveResult =
  | { ok: true; version: number; content: DfrContent; submittedVersion?: number }
  | { ok: false; error: "conflict"; server: { content: unknown; version: number; savedBy: string | null; savedAt: string } }
  | { ok: false; error: "invalid"; path: string }
  | { ok: false; error: "submitted" | "empty" | "forbidden" | "generic" };

/**
 * Save the draft (and optionally submit it). The server recomputes dew points
 * and spread rates. `basedOn` is the draft version the phone started from: if
 * someone else saved since, nothing is overwritten and their copy comes back.
 */
export async function saveDailyReport(payload: { id: string; content: unknown; basedOn: number; submit?: boolean }): Promise<SaveResult> {
  await requireProfile();
  if (!uuid.safeParse(payload?.id).success || !Number.isInteger(payload.basedOn)) return { ok: false, error: "generic" };
  const computed = computeReport(payload.content, await reportContext());
  if (!computed.ok) return { ok: false, error: "invalid", path: computed.path };
  const supabase = await createClient();
  const { data: version, error } = await supabase.rpc("save_daily_report", { p_id: payload.id, p_content: computed.content, p_based_on: payload.basedOn });
  if (error) return failure(error, payload.id);
  let submittedVersion: number | undefined;
  if (payload.submit) {
    const { data: v, error: e2 } = await supabase.rpc("submit_daily_report", { p_id: payload.id, p_based_on: version as number });
    if (e2) return failure(e2, payload.id);
    submittedVersion = v as number;
  }
  revalidatePath("/jobs", "layout");
  return { ok: true, version: version as number, content: computed.content, submittedVersion };
}

async function failure(e: { code?: string; message?: string }, id: string): Promise<SaveResult> {
  if (/version_conflict/.test(e.message ?? "")) {
    const supabase = await createClient();
    const { data } = await supabase.from("daily_field_reports").select("draft, version, draft_saved_by, draft_saved_at").eq("id", id).single();
    const { data: who } = data?.draft_saved_by ? await supabase.from("employee_directory").select("display_name").eq("id", data.draft_saved_by).maybeSingle() : { data: null };
    return { ok: false, error: "conflict", server: { content: data?.draft ?? {}, version: (data?.version as number) ?? 0, savedBy: (who?.display_name as string | undefined) ?? null, savedAt: (data?.draft_saved_at as string) ?? "" } };
  }
  if (/already submitted/.test(e.message ?? "")) return { ok: false, error: "submitted" };
  if (/empty/.test(e.message ?? "")) return { ok: false, error: "empty" };
  if (e.code === "42501") return { ok: false, error: "forbidden" };
  return { ok: false, error: "generic" };
}

export type ReviewResult = { ok: true } | { ok: false; error: "note" | "state" | "forbidden" | "generic" };

export async function reviewDailyReport(payload: { id: string; action: "accept" | "correct"; note?: string }): Promise<ReviewResult> {
  await requireProfile();
  if (!uuid.safeParse(payload?.id).success) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } =
    payload.action === "accept"
      ? await supabase.rpc("accept_daily_report", { p_id: payload.id })
      : await supabase.rpc("request_daily_report_correction", { p_id: payload.id, p_note: payload.note ?? "" });
  if (error) return { ok: false, error: /corrected/.test(error.message) ? "note" : error.code === "42501" ? "forbidden" : error.code === "P0001" ? "state" : "generic" };
  revalidatePath("/jobs", "layout");
  return { ok: true };
}
