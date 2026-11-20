"use client";
import { useTranslations } from "next-intl";
import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { type FormState, idle } from "@/lib/forms/form-state";

export function InviteButton({ action }: { action: (prev: FormState) => Promise<FormState> }) {
  const t = useTranslations();
  const [state, formAction] = useActionState(action, idle);
  return (
    <form action={formAction} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton pendingLabel={t("common.saving")} variant="secondary" size="md">
        {t("employees.resendInvite")}
      </SubmitButton>
    </form>
  );
}
