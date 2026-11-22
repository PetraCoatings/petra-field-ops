"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Archive, ArchiveRestore, BadgeCheck, CircleAlert } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { useRuntimeT } from "@/components/ui/form-message";
import { PRODUCT_CATEGORIES } from "@/domain/library/product";
import { saveProduct, setProductActive, setProductApproval } from "@/lib/actions/library";

export type ProductForm = Record<
  | "name"
  | "manufacturer"
  | "category"
  | "product_code"
  | "description"
  | "mix_ratio_a"
  | "mix_ratio_b"
  | "mix_ratio_text"
  | "ratio_basis"
  | "kit_size_gal"
  | "recommended_coverage_sqft_per_gal"
  | "volume_solids_pct"
  | "recommended_wft_mils"
  | "recommended_dft_mils"
  | "min_application_temp_f"
  | "max_application_temp_f"
  | "max_rh_pct"
  | "min_substrate_above_dew_point_f"
  | "pot_life_minutes"
  | "cure_notes",
  string
>;

type NumField = keyof ProductForm;

export function ProductEditor({
  id,
  initial,
  status,
  approvedLine,
  isActive,
  isAdmin,
  manufacturers,
}: {
  id: string;
  initial: ProductForm;
  status: "draft" | "approved";
  approvedLine: string | null;
  isActive: boolean;
  isAdmin: boolean;
  manufacturers: string[];
}) {
  const t = useTranslations("library");
  const rt = useRuntimeT();
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "error" | "success" | "warning"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const set = (k: keyof ProductForm, v: string) => setF((x) => ({ ...x, [k]: v }));

  const save = () =>
    startTransition(async () => {
      setMessage(null);
      const r = await saveProduct(id, f);
      if (r.ok) {
        setErrors({});
        setMessage(
          status === "approved" && r.status === "draft"
            ? { tone: "warning", text: t("backToDraft") }
            : { tone: "success", text: t("saved") },
        );
        router.refresh();
      } else {
        setErrors(r.errors ?? {});
        setMessage({ tone: "error", text: r.message ? rt(r.message)! : t("fixErrors") });
      }
    });

  const control =
    "block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-red-600";
  const field = (k: NumField, opts: { unit?: string; decimal?: boolean; wide?: boolean } = {}) => (
    <div className={`space-y-1 ${opts.wide ? "sm:col-span-2" : ""}`}>
      <label htmlFor={`p-${k}`} className="block text-sm font-semibold text-neutral-800">
        {t(`fields.${k}`)}
      </label>
      <div className="relative">
        <input
          id={`p-${k}`}
          value={f[k]}
          onChange={(e) => set(k, e.target.value)}
          inputMode={opts.decimal ? "decimal" : undefined}
          aria-invalid={Boolean(errors[k])}
          aria-describedby={errors[k] ? `p-${k}-err` : undefined}
          className={`${control} ${opts.unit ? "pr-16" : ""}`}
        />
        {opts.unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-neutral-600">{opts.unit}</span>}
      </div>
      {errors[k] && (
        <p id={`p-${k}-err`} role="alert" className="text-sm font-medium text-red-700">
          {rt(errors[k])}
        </p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      <section aria-label={t("approval")} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 p-4 ${status === "approved" ? "border-green-600 bg-green-50" : "border-accent-500 bg-amber-50"}`}>
        <div className="flex items-center gap-2">
          {status === "approved" ? <BadgeCheck aria-hidden className="size-6 text-green-700" /> : <CircleAlert aria-hidden className="size-6 text-amber-700" />}
          <div>
            <p className="text-base font-bold">{t(`status.${status}`)}</p>
            <p className="text-sm text-neutral-800">{approvedLine ?? (isAdmin ? t("draftHintAdmin") : t("draftHint"))}</p>
          </div>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => startTransition(async () => {
              await setProductApproval(id, status !== "approved");
              router.refresh();
            })}
            disabled={pending}
            className={buttonClasses(status === "approved" ? "secondary" : "primary", "md")}
          >
            {status === "approved" ? t("unapprove") : t("approve")}
          </button>
        )}
      </section>

      <section aria-labelledby="p-basics" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 id="p-basics" className="text-lg font-bold">
          {t("sections.basics")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("name")}
          <div className="space-y-1">
            <label htmlFor="p-manufacturer" className="block text-sm font-semibold text-neutral-800">
              {t("fields.manufacturer")}
            </label>
            <input id="p-manufacturer" list="p-mfr-list" value={f.manufacturer} onChange={(e) => set("manufacturer", e.target.value)} className={control} />
            <datalist id="p-mfr-list">
              {manufacturers.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
          <div className="space-y-1">
            <label htmlFor="p-category" className="block text-sm font-semibold text-neutral-800">
              {t("fields.category")}
            </label>
            <select id="p-category" value={f.category} onChange={(e) => set("category", e.target.value)} className={control}>
              <option value="">{t("notSpecified")}</option>
              {PRODUCT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
          {field("product_code")}
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="p-description" className="block text-sm font-semibold text-neutral-800">
              {t("fields.description")}
            </label>
            <textarea id="p-description" value={f.description} onChange={(e) => set("description", e.target.value)} rows={2} className={`${control} py-2`} />
          </div>
        </div>
      </section>

      <section aria-labelledby="p-specs" className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h2 id="p-specs" className="text-lg font-bold">
            {t("sections.specs")}
          </h2>
          <p className="text-sm text-neutral-600">{t("specsHint")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field("mix_ratio_a", { unit: "A", decimal: true })}
          {field("mix_ratio_b", { unit: "B", decimal: true })}
          <div className="space-y-1">
            <label htmlFor="p-ratio_basis" className="block text-sm font-semibold text-neutral-800">
              {t("fields.ratio_basis")}
            </label>
            <select id="p-ratio_basis" value={f.ratio_basis} onChange={(e) => set("ratio_basis", e.target.value)} className={control}>
              <option value="">{t("notSpecified")}</option>
              <option value="volume">{t("basis.volume")}</option>
              <option value="weight">{t("basis.weight")}</option>
            </select>
          </div>
          {field("mix_ratio_text")}
          {field("kit_size_gal", { unit: "gal", decimal: true })}
          {field("recommended_coverage_sqft_per_gal", { unit: "SF/gal", decimal: true })}
          {field("volume_solids_pct", { unit: "%", decimal: true })}
          {field("pot_life_minutes", { unit: "min", decimal: true })}
          {field("recommended_wft_mils", { unit: "mils", decimal: true })}
          {field("recommended_dft_mils", { unit: "mils", decimal: true })}
          {field("min_application_temp_f", { unit: "°F", decimal: true })}
          {field("max_application_temp_f", { unit: "°F", decimal: true })}
          {field("max_rh_pct", { unit: "%", decimal: true })}
          {field("min_substrate_above_dew_point_f", { unit: "°F", decimal: true })}
          <div className="space-y-1 sm:col-span-2">
            <label htmlFor="p-cure_notes" className="block text-sm font-semibold text-neutral-800">
              {t("fields.cure_notes")}
            </label>
            <textarea id="p-cure_notes" value={f.cure_notes} onChange={(e) => set("cure_notes", e.target.value)} rows={2} className={`${control} py-2`} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={pending} className={buttonClasses("primary", "lg")}>
          {pending ? t("saving") : t("save")}
        </button>
        <button
          type="button"
          onClick={() => startTransition(async () => {
            await setProductActive(id, !isActive);
            router.refresh();
          })}
          className={buttonClasses("ghost", "md")}
        >
          {isActive ? <Archive aria-hidden className="size-5" /> : <ArchiveRestore aria-hidden className="size-5" />}
          {isActive ? t("archive") : t("restore")}
        </button>
        {message && (
          <p role="status" className={`text-sm font-semibold ${message.tone === "error" ? "text-red-700" : message.tone === "warning" ? "text-amber-800" : "text-green-800"}`}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
