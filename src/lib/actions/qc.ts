"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { type FormState } from "@/lib/forms/form-state";
import { DEW_POINT_TEST_CODE, dewPointReading } from "@/domain/reports/qc-dew-point";
import { reportContext } from "@/lib/reports/context";

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
/** Accepts "75", "1.5", "1,000", "1e6". Empty → null. */
function number(raw: FormDataEntryValue | null): number | null | "bad" {
  const s = String(raw ?? "").trim().replace(/,/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : "bad";
}

export async function addQcRequirement(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireProfile();
  const type = uuid.safeParse(fd.get("test_type_id"));
  const min = number(fd.get("min"));
  const max = number(fd.get("max"));
  if (!uuid.safeParse(projectId).success || !type.success) return { status: "error", message: "qc.errors.type" };
  if (min === "bad" || max === "bad" || (min !== null && max !== null && min > max)) return { status: "error", message: "qc.errors.limits" };
  const supabase = await createClient();
  // Dew point with no limit typed: the company margin (°F above the dew point).
  let minValue = min;
  if (min === null && max === null) {
    const { data: tt } = await supabase.from("qc_test_types").select("code").eq("id", type.data).maybeSingle();
    if (tt?.code === DEW_POINT_TEST_CODE) minValue = (await reportContext()).companyMarginF;
  }
  const { error } = await supabase.from("qc_requirements").insert({
    project_id: projectId,
    test_type_id: type.data,
    min_value: minValue,
    max_value: max,
    notes: String(fd.get("notes") ?? "").trim().slice(0, 300) || null,
  });
  if (error) return { status: "error", message: error.code === "23505" ? "qc.errors.duplicate" : error.code === "42501" ? "qc.errors.forbidden" : "common.genericError" };
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath(`/manage/projects/${projectId}`);
  return { status: "success", message: "qc.added" };
}

export async function removeQcRequirement(fd: FormData): Promise<void> {
  await requireProfile();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  const { data } = await supabase.from("qc_requirements").delete().eq("id", id.data).select("project_id").maybeSingle();
  if (data) {
    revalidatePath(`/jobs/${data.project_id}`);
    revalidatePath(`/manage/projects/${data.project_id}`);
  }
}

export async function recordQcReading(projectId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  await requireProfile();
  const type = uuid.safeParse(fd.get("test_type_id"));
  if (!uuid.safeParse(projectId).success || !type.success) return { status: "error", message: "qc.errors.type" };
  const supabase = await createClient();
  const { data: tt } = await supabase.from("qc_test_types").select("code").eq("id", type.data).maybeSingle();
  let value = number(fd.get("value"));
  let inputs: Record<string, unknown> | null = null;
  if (tt?.code === DEW_POINT_TEST_CODE) {
    // Dew point: computed here from the three readings (same formula as the calculator).
    const [air, rh, surface] = [number(fd.get("air_temp")), number(fd.get("humidity")), number(fd.get("surface_temp"))];
    if (typeof air !== "number" || typeof rh !== "number" || typeof surface !== "number") return { status: "error", message: "qc.errors.dewInputs" };
    const r = dewPointReading({ airTempF: air, humidityPct: rh, surfaceTempF: surface });
    if ("error" in r) return { status: "error", message: `qc.errors.${r.error}` };
    value = r.value;
    inputs = r.inputs;
  }
  if (value === null || value === "bad") return { status: "error", message: "qc.errors.value" };
  const { error } = await supabase.rpc("record_qc_measurement", {
    p_project_id: projectId,
    p_test_type_id: type.data,
    p_value: value,
    p_location: String(fd.get("location") ?? ""),
    p_method: String(fd.get("method") ?? ""),
    p_notes: String(fd.get("notes") ?? ""),
    p_inputs: inputs,
  });
  if (error) return { status: "error", message: error.code === "42501" ? "qc.errors.forbidden" : "common.genericError" };
  revalidatePath(`/jobs/${projectId}`);
  revalidatePath(`/manage/projects/${projectId}`);
  return { status: "success", message: "qc.recorded" };
}

export async function removeQcReading(fd: FormData): Promise<void> {
  await requireProfile();
  const id = uuid.safeParse(fd.get("id"));
  if (!id.success) return;
  const supabase = await createClient();
  const { data } = await supabase.from("qc_measurements").delete().eq("id", id.data).select("project_id").maybeSingle();
  if (data) {
    revalidatePath(`/jobs/${data.project_id}`);
    revalidatePath(`/manage/projects/${data.project_id}`);
  }
}
