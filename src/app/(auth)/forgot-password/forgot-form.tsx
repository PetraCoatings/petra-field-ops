"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { TextField } from "@/components/ui/field";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import { requestPasswordReset } from "@/lib/actions/auth";
import { idle } from "@/lib/forms/form-state";

export function ForgotForm() {
  const t = useTranslations();
  const rt = useRuntimeT();
  const [state, action] = useActionState(requestPasswordReset, idle);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      {state.status !== "success" && (
        <>
          <TextField
            label={t("auth.email")}
            name="email"
            type="email"
            autoComplete="username"
            inputMode="email"
            autoCapitalize="none"
            required
            error={rt(state.fieldErrors?.email)}
          />
          <SubmitButton pendingLabel={t("common.saving")} className="w-full">
            {t("auth.sendResetLink")}
          </SubmitButton>
        </>
      )}
      <p className="text-center">
        <Link href="/login" className="inline-block min-h-11 py-2 font-semibold text-brand-700 underline">
          {t("auth.backToSignIn")}
        </Link>
      </p>
    </form>
  );
}
