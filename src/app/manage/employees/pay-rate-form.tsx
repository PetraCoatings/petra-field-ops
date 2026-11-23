"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import { type FormState, idle } from "@/lib/forms/form-state";

/** Office admin: add a pay rate. A raise is a new rate with a later start date. */
export function PayRateForm({ action, today }: { action: (prev: FormState, fd: FormData) => Promise<FormState>; today: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(action, idle);
  const rt = useRuntimeT();
  const err = (k: string) => rt(state.fieldErrors?.[k]);
  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label={t("payRates.category")} name="category" defaultValue="job">
          <option value="job">{t("timeClock.categories.job")}</option>
          <option value="drive">{t("timeClock.categories.drive")}</option>
          <option value="ride">{t("timeClock.categories.ride")}</option>
        </SelectField>
        <TextField label={t("payRates.rate")} name="rate" inputMode="decimal" placeholder="25.00" required error={err("rate")} />
        <TextField label={t("payRates.effectiveFrom")} name="effective_from" type="date" defaultValue={today} required error={err("effective_from")} />
      </div>
      <TextField label={t("payRates.note")} name="note" placeholder={t("payRates.noteExample")} />
      <SubmitButton pendingLabel={t("common.saving")} variant="secondary" size="md">
        {t("payRates.add")}
      </SubmitButton>
    </form>
  );
}
