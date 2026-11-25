"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { saveReportCore, type SaveCoreResult } from "@/lib/reports/save-core";

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

export type SaveResult = SaveCoreResult;

/** Save the draft (and optionally submit it); see lib/reports/save-core.ts. */
export async function saveDailyReport(payload: { id: string; content: unknown; basedOn: number; submit?: boolean }): Promise<SaveResult> {
  await requireProfile();
  const r = await saveReportCore(await createClient(), payload);
  if (r.ok) revalidatePath("/jobs", "layout");
  return r;
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

/** Office (PMs and office admins): open a submitted report for editing before accepting it. */
export async function editSubmittedDailyReport(payload: { id: string }): Promise<ReviewResult> {
  await requireProfile();
  if (!uuid.safeParse(payload?.id).success) return { ok: false, error: "generic" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("edit_submitted_daily_report", { p_id: payload.id });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : error.code === "P0001" ? "state" : "generic" };
  revalidatePath("/jobs", "layout");
  return { ok: true };
}
