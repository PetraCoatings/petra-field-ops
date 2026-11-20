"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { CheckboxField, SelectField, TextField } from "@/components/ui/field";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import { ROLES } from "@/lib/auth/roles";
import type { EmployeeRow } from "@/lib/db/types";
import { type FormState, idle } from "@/lib/forms/form-state";

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  employee?: EmployeeRow;
};

export function EmployeeForm({ action, employee }: Props) {
  const t = useTranslations();
  const rt = useRuntimeT();
  const [state, formAction] = useActionState(action, idle);
  const err = (k: string) => rt(state.fieldErrors?.[k]);
  const isNew = !employee;
  const emailLocked = Boolean(employee?.user_id);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label={t("employees.firstName")} name="first_name" defaultValue={employee?.first_name} required error={err("first_name")} />
        <TextField label={t("employees.lastName")} name="last_name" defaultValue={employee?.last_name} required error={err("last_name")} />
        <TextField
          label={t("employees.email")}
          name="email"
          type="email"
          autoCapitalize="none"
          defaultValue={employee?.email}
          readOnly={emailLocked}
          help={emailLocked ? t("employees.emailLockedHelp") : undefined}
          required
          error={err("email")}
        />
        <TextField label={t("employees.phone")} name="phone" type="tel" defaultValue={employee?.phone ?? ""} />
        <SelectField label={t("employees.role")} name="role" defaultValue={employee?.role ?? "installer"} error={err("role")}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {t(`roles.${r}`)}
            </option>
          ))}
        </SelectField>
        <SelectField
          label={t("employees.flsaStatus")}
          name="flsa_status"
          defaultValue={employee?.flsa_status ?? "nonexempt"}
          error={err("flsa_status")}
        >
          <option value="nonexempt">{t("employees.nonexempt")}</option>
          <option value="exempt">{t("employees.exempt")}</option>
        </SelectField>
        <TextField label={t("employees.hireDate")} name="hire_date" type="date" defaultValue={employee?.hire_date ?? ""} error={err("hire_date")} />
        <SelectField label={t("employees.language")} name="preferred_locale" defaultValue={employee?.preferred_locale ?? "en"}>
          <option value="en">English</option>
          <option value="es">Español</option>
        </SelectField>
      </div>
      {isNew ? (
        <CheckboxField label={t("employees.sendInvite")} name="send_invite" defaultChecked />
      ) : (
        <CheckboxField
          label={t("employees.active")}
          name="is_active"
          defaultChecked={employee.is_active}
          help={t("employees.activeHelp")}
        />
      )}
      <SubmitButton pendingLabel={t("common.saving")}>{t("common.save")}</SubmitButton>
    </form>
  );
}
