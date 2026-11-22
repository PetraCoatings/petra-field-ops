"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import { createTemplate } from "@/lib/actions/templates";
import { idle } from "@/lib/forms/form-state";

export function NewTemplateForm() {
  const t = useTranslations("templates");
  const rt = useRuntimeT();
  const [state, action, pending] = useActionState(createTemplate, idle);
  const error = state.fieldErrors?.name;
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor="template-name" className="block text-sm font-semibold text-neutral-800">
            {t("newName")}
          </label>
          <input
            id="template-name"
            name="name"
            required
            maxLength={120}
            placeholder={t("newNamePlaceholder")}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "template-name-error" : undefined}
            className="block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-red-600"
          />
        </div>
        <button type="submit" disabled={pending} className={buttonClasses("primary", "md")}>
          <Plus aria-hidden className="size-5" />
          {t("create")}
        </button>
      </div>
      {error && (
        <p id="template-name-error" role="alert" className="text-sm font-medium text-red-700">
          {rt(error)}
        </p>
      )}
    </form>
  );
}
