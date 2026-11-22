"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { FormMessage, useRuntimeT } from "@/components/ui/form-message";
import { createProduct } from "@/lib/actions/library";
import { idle } from "@/lib/forms/form-state";

export function NewProductForm({ manufacturers }: { manufacturers: string[] }) {
  const t = useTranslations("library");
  const rt = useRuntimeT();
  const [state, action, pending] = useActionState(createProduct, idle);
  const err = state.fieldErrors?.name;
  const input = "block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none";
  return (
    <form action={action} className="space-y-2">
      <FormMessage state={state} />
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <label htmlFor="np-name" className="block text-sm font-semibold text-neutral-800">
            {t("newProduct")}
          </label>
          <input id="np-name" name="name" required maxLength={160} placeholder={t("namePlaceholder")} aria-invalid={Boolean(err)} className={input} />
        </div>
        <div className="space-y-1">
          <label htmlFor="np-mfr" className="block text-sm font-semibold text-neutral-800">
            {t("fields.manufacturer")}
          </label>
          <input id="np-mfr" name="manufacturer" list="manufacturer-list" maxLength={120} placeholder="Sika" className={input} />
          <datalist id="manufacturer-list">
            {manufacturers.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
        <button type="submit" disabled={pending} className={buttonClasses("primary", "md")}>
          <Plus aria-hidden className="size-5" />
          {t("create")}
        </button>
      </div>
      {err && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {rt(err)}
        </p>
      )}
    </form>
  );
}
