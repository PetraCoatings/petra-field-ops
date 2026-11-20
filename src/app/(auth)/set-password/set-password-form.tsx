"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import { setPassword } from "@/lib/actions/auth";
import { idle } from "@/lib/forms/form-state";

export function SetPasswordForm() {
  const t = useTranslations();
  const rt = useRuntimeT();
  const [state, action] = useActionState(setPassword, idle);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextField
        label={t("auth.newPassword")}
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        help={t("auth.passwordRules")}
        error={rt(state.fieldErrors?.password)}
      />
      <TextField
        label={t("auth.confirmPassword")}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        error={rt(state.fieldErrors?.confirm)}
      />
      <SubmitButton pendingLabel={t("common.saving")} className="w-full">
        {t("auth.savePassword")}
      </SubmitButton>
    </form>
  );
}
