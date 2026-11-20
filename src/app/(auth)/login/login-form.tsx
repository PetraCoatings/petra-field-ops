"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { CheckboxField, TextField } from "@/components/ui/field";
import { FormMessage } from "@/components/ui/form-message";
import { signIn } from "@/lib/actions/auth";
import { idle } from "@/lib/forms/form-state";

export function LoginForm() {
  const t = useTranslations();
  const [state, action] = useActionState(signIn, idle);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-4" noValidate>
      <FormMessage state={state} />
      <TextField
        label={t("auth.email")}
        name="email"
        type="email"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        required
      />
      <TextField
        label={t("auth.password")}
        name="password"
        type={show ? "text" : "password"}
        autoComplete="current-password"
        required
      />
      <CheckboxField
        label={t("auth.showPassword")}
        name="show-password"
        checked={show}
        onChange={(e) => setShow(e.target.checked)}
      />
      <SubmitButton pendingLabel={t("auth.signingIn")} className="w-full">
        {t("auth.signIn")}
      </SubmitButton>
      <p className="text-center">
        <Link href="/forgot-password" className="inline-block min-h-11 py-2 font-semibold text-brand-700 underline">
          {t("auth.forgotPassword")}
        </Link>
      </p>
    </form>
  );
}
