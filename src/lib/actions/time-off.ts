"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { type FormState } from "@/lib/forms/form-state";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function messageFor(e: { code?: string; message?: string }): string {
  const m = e.message ?? "";
  if (/already asked/.test(m)) return "timeOff.errors.overlap";
  if (/before the first/.test(m)) return "timeOff.errors.dates";
  if (/reason/.test(m)) return "timeOff.errors.reason";
  if (/already decided/.test(m)) return "timeOff.errors.decided";
  if (/can't be cancelled/.test(m)) return "timeOff.errors.cancel";
  if (e.code === "42501") return "timeOff.errors.forbidden";
  if (e.code === "23514") return "timeOff.errors.tooLong";
  return "common.genericError";
}
const done = () => {
  revalidatePath("/", "layout");
};

export async function requestTimeOff(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireProfile();
  const parsed = z
    .object({
      type: uuid,
      start: date,
      end: date,
      partial: z.string().trim().regex(/^(\d{1,2}(\.\d{1,2})?)?$/),
      notes: z.string().trim().max(500),
    })
    .safeParse({ type: fd.get("leave_type"), start: fd.get("start"), end: fd.get("end") || fd.get("start"), partial: fd.get("partial_hours") ?? "", notes: fd.get("notes") ?? "" });
  if (!parsed.success) return { status: "error", message: "timeOff.errors.form" };
  const p = parsed.data;
  if (p.partial && p.start !== p.end) return { status: "error", message: "timeOff.errors.partial" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_time_off", {
    p_leave_type_id: p.type,
    p_start: p.start,
    p_end: p.end,
    p_partial_hours: p.partial ? Number(p.partial) : null,
    p_notes: p.notes || null,
  });
  if (error) return { status: "error", message: messageFor(error) };
  done();
  return { status: "success", message: "timeOff.sent" };
}

export type SimpleResult = { ok: true } | { ok: false; message: string };

export async function decideTimeOff(payload: { id: string; approve: boolean; note: string }): Promise<SimpleResult> {
  await requireProfile();
  const parsed = z.object({ id: uuid, approve: z.boolean(), note: z.string().max(500) }).safeParse(payload);
  if (!parsed.success) return { ok: false, message: "common.genericError" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_time_off", { p_request_id: parsed.data.id, p_approve: parsed.data.approve, p_note: parsed.data.note || null });
  if (error) return { ok: false, message: messageFor(error) };
  done();
  return { ok: true };
}

export async function cancelTimeOff(fd: FormData): Promise<void> {
  await requireProfile();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  await supabase.rpc("cancel_time_off", { p_request_id: id.data });
  done();
}
