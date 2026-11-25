import { getFormatter, getTranslations } from "next-intl/server";
import { ClipboardCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { addQcRequirement, recordQcReading, removeQcReading, removeQcRequirement } from "@/lib/actions/qc";
import { directoryNames } from "@/lib/db/queries";
import { limitText } from "@/domain/reports/qc";
import { reportContext } from "@/lib/reports/context";
import { AddRequirementForm, RecordReadingForm } from "./qc-forms";

type Req = { id: string; test_type_id: string; min_value: string | null; max_value: string | null; notes: string | null };
type Reading = {
  id: string;
  test_type_id: string;
  value: string;
  unit: string;
  method: string | null;
  location: string | null;
  notes: string | null;
  measured_at: string;
  measured_by: string | null;
  criteria_min: string | null;
  criteria_max: string | null;
  result: "pass" | "fail" | null;
  created_at: string;
  inputs: { airTempF: number; humidityPct: number; surfaceTempF: number; dewPointF: number } | null;
};
const n = (v: string | null) => (v === null ? null : Number(v));

/**
 * "Quality control" on the job screen: the tests the job needs (with limits
 * when set), and the readings. Pass/fail shows only when a limit existed when
 * the reading was taken.
 */
export async function QcCard({
  projectId,
  canRecord,
  canSetRequirements,
  me,
  workOrderTests,
  now,
}: {
  projectId: string;
  canRecord: boolean;
  canSetRequirements: boolean;
  me: string;
  workOrderTests: { test: string; target?: string }[];
  now: number;
}) {
  const t = await getTranslations("qc");
  const format = await getFormatter();
  const supabase = await createClient();
  const [{ data: types }, { data: reqs }, { data: readings }] = await Promise.all([
    supabase.from("qc_test_types").select("id, code, name, unit, method").eq("is_active", true).order("sort"),
    supabase.from("qc_requirements").select("id, test_type_id, min_value, max_value, notes").eq("project_id", projectId),
    supabase.from("qc_measurements").select("*").eq("project_id", projectId).order("measured_at", { ascending: false }).limit(100),
  ]);
  const CODES = ["moisture_rh", "moisture_cacl", "ph", "csp", "wft", "dft", "adhesion", "esd", "dew_point"] as const;
  const typeList = ((types ?? []) as { id: string; code: string; name: string; unit: string; method: string | null }[]).map((x) => ({
    ...x,
    name: (CODES as readonly string[]).includes(x.code) ? t(`types.${x.code as (typeof CODES)[number]}`) : x.name,
  }));
  const requirements = (reqs ?? []) as Req[];
  const list = (readings ?? []) as Reading[];
  if (!canRecord && !canSetRequirements && requirements.length === 0 && list.length === 0 && workOrderTests.length === 0) return null;
  const typeOf = new Map(typeList.map((x) => [x.id, x]));
  const names = await directoryNames(list.map((r) => r.measured_by));
  const num = (x: number) => format.number(x, { maximumFractionDigits: 6 });
  const badge = (r: Reading["result"]) =>
    r === "pass" ? (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-sm font-bold text-green-900">{t("pass")}</span>
    ) : r === "fail" ? (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-sm font-bold text-red-900">{t("fail")}</span>
    ) : (
      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-sm text-neutral-700">{t("recordedOnly")}</span>
    );
  const office = canSetRequirements;

  return (
    <section aria-labelledby="qc-card" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <h2 id="qc-card" className="flex items-center gap-2 text-lg font-bold">
        <ClipboardCheck aria-hidden className="size-6 text-brand-700" />
        {t("title")}
      </h2>

      {workOrderTests.length > 0 && (
        <div className="text-sm text-neutral-700">
          <p className="font-semibold">{t("fromWorkOrder")}</p>
          <ul className="list-disc pl-5">
            {workOrderTests.map((w, i) => (
              <li key={i}>
                {w.test}
                {w.target ? ` · ${w.target}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="font-semibold">{t("requiredTests")}</h3>
        {requirements.length === 0 ? (
          <p className="text-sm text-neutral-600">{t("noRequirements")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {requirements.map((r) => {
              const type = typeOf.get(r.test_type_id);
              const limit = type ? limitText(n(r.min_value), n(r.max_value), type.unit, num) : null;
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-semibold">{type?.name}</span>
                    <span className="block text-sm text-neutral-700">
                      {limit ? t("limit", { limit }) : t("noLimit")}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </span>
                  </span>
                  {office && (
                    <form action={removeQcRequirement}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-sm font-semibold text-red-800 underline" aria-label={t("removeRequirement", { test: type?.name ?? "" })}>
                        {t("remove")}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {office && (
        <AddRequirementForm
          action={addQcRequirement.bind(null, projectId)}
          types={typeList.filter((x) => !requirements.some((r) => r.test_type_id === x.id))}
          companyMarginF={(await reportContext()).companyMarginF}
        />
      )}
      {canRecord && (
        <RecordReadingForm
          action={recordQcReading.bind(null, projectId)}
          types={typeList}
          preferred={requirements.map((r) => r.test_type_id)}
          minimums={Object.fromEntries(requirements.map((r) => [r.test_type_id, n(r.min_value)]))}
        />
      )}

      <div>
        <h3 className="font-semibold">{t("readings")}</h3>
        {list.length === 0 ? (
          <p className="text-sm text-neutral-600">{t("noReadings")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200" aria-label={t("readings")}>
            {list.map((r) => {
              const type = typeOf.get(r.test_type_id);
              const limit = limitText(n(r.criteria_min), n(r.criteria_max), r.unit, num);
              const canRemove = office || (r.measured_by === me && now - Date.parse(r.created_at) < 24 * 3_600_000);
              return (
                <li key={r.id} className="space-y-1 py-2">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{type?.name}</span>
                    <span className="tabular-nums">
                      {num(Number(r.value))} {r.unit}
                    </span>
                    {badge(r.result)}
                  </p>
                  <p className="text-sm text-neutral-700">
                    {[r.location, limit ? t("againstLimit", { limit }) : null, r.method, names.get(r.measured_by ?? "")?.display_name, format.dateTime(new Date(r.measured_at), { dateStyle: "medium", timeStyle: "short" })]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {r.inputs && (
                    <p className="text-sm text-neutral-700">
                      {t("dewPointDetails", { air: num(r.inputs.airTempF), rh: num(r.inputs.humidityPct), surface: num(r.inputs.surfaceTempF), dew: num(r.inputs.dewPointF) })}
                    </p>
                  )}
                  {r.notes && <p className="text-sm">{r.notes}</p>}
                  {canRemove && (
                    <form action={removeQcReading}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="text-sm font-semibold text-red-800 underline">
                        {t("removeReading")}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <p className="text-sm text-neutral-600">{t("rule")}</p>
    </section>
  );
}
