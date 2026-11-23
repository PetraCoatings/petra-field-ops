"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { idle, type FormState } from "@/lib/forms/form-state";

type TestType = { id: string; name: string; unit: string; method: string | null };
type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Office: add a test this job needs, with optional limits. */
export function AddRequirementForm({ action, types }: { action: Action; types: TestType[] }) {
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
      <TextField label={t("requirementNotes")} name="notes" placeholder={t("requirementNotesExample")} />
      <SubmitButton pendingLabel={tc("saving")} variant="secondary" size="md">
        {t("addRequirementButton")}
      </SubmitButton>
    </form>
  );
}

/** Crew lead: record a reading. */
export function RecordReadingForm({ action, types, preferred }: { action: Action; types: TestType[]; preferred: string[] }) {
  const t = useTranslations("qc");
  const tc = useTranslations("common");
  const [state, formAction] = useActionState(action, idle);
  const sorted = [...types].sort((a, b) => Number(preferred.includes(b.id)) - Number(preferred.includes(a.id)));
  return (
    <form action={formAction} className="space-y-3 rounded-xl border-2 border-brand-600 bg-brand-50 p-3">
      <p className="font-semibold">{t("record")}</p>
      <FormMessage state={state} />
      <SelectField label={t("test")} name="test_type_id" required>
        {sorted.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.unit}){preferred.includes(x.id) ? ` · ${t("required")}` : ""}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-2 gap-3">
        <TextField label={t("value")} name="value" inputMode="decimal" required />
        <TextField label={t("location")} name="location" placeholder={t("locationExample")} />
      </div>
      <TextField label={t("notes")} name="notes" />
      <SubmitButton pendingLabel={tc("saving")} variant="primary" size="md">
        {t("save")}
      </SubmitButton>
    </form>
  );
}
