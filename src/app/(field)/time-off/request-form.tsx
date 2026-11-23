"use client";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { SubmitButton } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { requestTimeOff } from "@/lib/actions/time-off";
import { idle } from "@/lib/forms/form-state";

export function RequestForm({ types, today }: { types: { id: string; name: string }[]; today: string }) {
  const t = useTranslations("timeOff");
  const tc = useTranslations("common");
  const [state, action] = useActionState(requestTimeOff, idle);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const oneDay = !end || end === start;
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SelectField label={t("type")} name="leave_type" required defaultValue={types[0]?.id}>
        {types.map((x) => (
          <option key={x.id} value={x.id}>
            {(["Vacation", "Sick", "Personal", "Unpaid"] as const).includes(x.name as "Vacation") ? t(`types.${x.name as "Vacation" | "Sick" | "Personal" | "Unpaid"}`) : x.name}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t("first")}
          name="start"
          type="date"
          required
          value={start}
          min={today}
          onChange={(e) => {
            setStart(e.target.value);
            if (!end || end < e.target.value) setEnd(e.target.value);
          }}
        />
        <TextField label={t("last")} name="end" type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
      </div>
      {oneDay && <TextField label={t("partial")} name="partial_hours" inputMode="decimal" placeholder={t("partialExample")} help={t("partialHelp")} />}
      <TextField label={t("notes")} name="notes" placeholder={t("notesExample")} maxLength={500} />
      <SubmitButton pendingLabel={tc("saving")} variant="primary" size="lg">
        {t("send")}
      </SubmitButton>
    </form>
  );
}
