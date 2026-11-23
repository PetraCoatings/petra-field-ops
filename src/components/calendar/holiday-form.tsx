"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { addHoliday } from "@/lib/actions/calendar";
import { idle } from "@/lib/forms/form-state";

export function HolidayForm() {
  const t = useTranslations("calendar.holidays");
  const tc = useTranslations("common");
  const [state, action] = useActionState(addHoliday, idle);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={t("date")} name="date" type="date" required />
        <TextField label={t("name")} name="name" placeholder={t("nameExample")} required />
      </div>
      <CheckboxField label={t("paid")} name="paid" defaultChecked />
      <SubmitButton pendingLabel={tc("saving")} variant="secondary" size="md">
        {t("add")}
      </SubmitButton>
    </form>
  );
}
