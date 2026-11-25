"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { idle, type FormState } from "@/lib/forms/form-state";
import { DEW_POINT_TEST_CODE, dewPointReading } from "@/domain/reports/qc-dew-point";

type TestType = { id: string; code: string; name: string; unit: string; method: string | null };
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Office: add a test this job needs, with optional limits. */
export function AddRequirementForm({ action, types, companyMarginF }: { action: Action; types: TestType[]; companyMarginF: number }) {
  const t = useTranslations("qc");
  const tc = useTranslations("common");
  const [state, formAction] = useActionState(action, idle);
  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-neutral-200 p-3">
      <p className="font-semibold">{t("addRequirement")}</p>
      <FormMessage state={state} />
      <SelectField label={t("test")} name="test_type_id" required>
        {types.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.unit})
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label={t("min")} name="min" inputMode="decimal" help={t("limitHelp")} />
        <TextField label={t("max")} name="max" inputMode="decimal" />
      </div>
      {types.some((x) => x.code === DEW_POINT_TEST_CODE) && <p className="text-sm text-neutral-700">{t("dewPointRequirementHelp", { margin: companyMarginF })}</p>}
      <TextField label={t("requirementNotes")} name="notes" placeholder={t("requirementNotesExample")} />
      <SubmitButton pendingLabel={tc("saving")} variant="secondary" size="md">
        {t("addRequirementButton")}
      </SubmitButton>
    </form>
  );
}

/** Crew lead: record a reading. */
export function RecordReadingForm({ action, types, preferred, minimums }: { action: Action; types: TestType[]; preferred: string[]; minimums: Record<string, number | null> }) {
  const t = useTranslations("qc");
  const tc = useTranslations("common");
  const [state, formAction] = useActionState(action, idle);
  const sorted = [...types].sort((a, b) => Number(preferred.includes(b.id)) - Number(preferred.includes(a.id)));
  const [typeId, setTypeId] = useState(sorted[0]?.id ?? "");
  const [dew, setDew] = useState({ air: "", rh: "", surface: "" });
  const isDewPoint = types.find((x) => x.id === typeId)?.code === DEW_POINT_TEST_CODE;
  const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));
  const preview = isDewPoint ? dewPointReading({ airTempF: num(dew.air), humidityPct: num(dew.rh), surfaceTempF: num(dew.surface) }) : null;
  const min = minimums[typeId] ?? null;
  return (
    <form action={formAction} className="space-y-3 rounded-xl border-2 border-brand-600 bg-brand-50 p-3">
      <p className="font-semibold">{t("record")}</p>
      <FormMessage state={state} />
      <SelectField label={t("test")} name="test_type_id" required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
        {sorted.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.unit}){preferred.includes(x.id) ? ` · ${t("required")}` : ""}
          </option>
        ))}
      </SelectField>
      {isDewPoint ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <TextField label={t("airTemp")} name="air_temp" inputMode="decimal" required value={dew.air} onChange={(e) => setDew({ ...dew, air: e.target.value })} />
            <TextField label={t("humidity")} name="humidity" inputMode="decimal" required value={dew.rh} onChange={(e) => setDew({ ...dew, rh: e.target.value })} />
            <TextField label={t("surfaceTemp")} name="surface_temp" inputMode="decimal" required value={dew.surface} onChange={(e) => setDew({ ...dew, surface: e.target.value })} />
          </div>
          {preview && !("error" in preview) && (
            <p role="status" className={`rounded-lg px-3 py-2 text-base font-semibold ${preview.value <= 0 || (min !== null && preview.value < min) ? "bg-red-50 text-red-900" : "bg-white text-neutral-900"}`}>
              {preview.value <= 0 ? t("dewPointBelow", { spread: Math.abs(preview.value) }) : t("dewPointPreview", { dew: preview.inputs.dewPointF, spread: preview.value })}
              {min !== null && <span className="block text-sm font-normal">{t("dewPointNeeds", { min })}</span>}
            </p>
          )}
          <TextField label={t("location")} name="location" placeholder={t("locationExample")} />
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <TextField label={t("value")} name="value" inputMode="decimal" required />
          <TextField label={t("location")} name="location" placeholder={t("locationExample")} />
        </div>
      )}
      <TextField label={t("notes")} name="notes" />
      <SubmitButton pendingLabel={tc("saving")} variant="primary" size="md">
        {t("save")}
      </SubmitButton>
    </form>
  );
}
