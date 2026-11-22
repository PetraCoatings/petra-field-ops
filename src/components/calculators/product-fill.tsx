"use client";

import { useTranslations } from "next-intl";
import type { PickerProduct } from "@/lib/library/picker-types";

/**
 * "Fill from a product (optional)": picks an approved product and hands it to
 * the calculator, which copies in whatever that product's data sheet specifies.
 * Fields the product doesn't specify are left as they are.
 */
export function ProductFill({
  products,
  value,
  onPick,
  relevant,
  showHint = true,
}: {
  products: PickerProduct[];
  value: string;
  onPick: (p: PickerProduct | null) => void;
  /** Only offer products that have something to fill in for this calculator. */
  relevant: (p: PickerProduct) => boolean;
  showHint?: boolean;
}) {
  const t = useTranslations("calculators.productFill");
  const options = products.filter(relevant);
  if (options.length === 0) return null;
  return (
    <div className="space-y-1">
      <label htmlFor="calc-product" className="block text-sm font-semibold text-neutral-800">
        {t("label")}
      </label>
      <select
        id="calc-product"
        value={value}
        onChange={(e) => onPick(options.find((p) => p.id === e.target.value) ?? null)}
        className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none"
      >
        <option value="">{t("none")}</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.manufacturer ? `${p.name} (${p.manufacturer})` : p.name}
          </option>
        ))}
      </select>
      {value && showHint && <p className="text-sm text-neutral-700">{t("hint")}</p>}
    </div>
  );
}
