"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import type { AppSettingsRow } from "@/lib/db/types";
import { idle } from "@/lib/forms/form-state";
import { updateSettings } from "./actions";

const DAYS = ["1", "2", "3", "4", "5", "6", "7"] as const;

export function SettingsForm({ settings }: { settings: AppSettingsRow }) {
  const t = useTranslations("settings");
  const tc = useTranslations("common");
  const rt = useRuntimeT();
  const [state, action] = useActionState(updateSettings, idle);
  const err = (k: string) => rt(state.fieldErrors?.[k]);
  return (
    <form action={action} className="space-y-6" noValidate>
      <FormMessage state={state} />
      <fieldset className="space-y-3">
        <legend className="text-base font-bold">{t("workweek")}</legend>
        <p className="text-sm text-neutral-700">{t("workweekHelp")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label={t("workweekStartDay")}
            name="workweek_start_dow"
            defaultValue={String(settings.workweek_start_dow)}
            error={err("workweek_start_dow")}
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {t(`days.${d}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={t("workweekStartTime")}
            name="workweek_start_time"
            type="time"
            defaultValue={settings.workweek_start_time.slice(0, 5)}
            error={err("workweek_start_time")}
          />
        </div>
      </fieldset>
      <TextField
        label={t("selfEditWindow")}
        name="self_edit_window_hours"
        inputMode="numeric"
        defaultValue={settings.self_edit_window_hours}
        help={t("selfEditWindowHelp")}
        error={err("self_edit_window_hours")}
      />
      <CheckboxField
        label={t("gpsOnSwitch")}
        name="gps_on_category_switch"
        defaultChecked={settings.gps_on_category_switch}
        help={t("gpsOnSwitchHelp")}
      />
      <TextField
        label={t("dewPointMargin")}
        name="dew_point_margin_f"
        inputMode="decimal"
        defaultValue={settings.dew_point_margin_f}
        help={t("dewPointMarginHelp")}
        error={err("dew_point_margin_f")}
      />
      <SubmitButton pendingLabel={tc("saving")}>{tc("save")}</SubmitButton>
    </form>
  );
}
