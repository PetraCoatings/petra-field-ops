import { getFormatter, getTranslations } from "next-intl/server";
import { mixRatioLabel } from "@/domain/library/product";
import type { FieldProduct } from "@/lib/library/field-products";

/**
 * A product's specs for the crew. Blank fields read "not specified" (never a
 * guess). `compact` shows only the handful that matter most on a card.
 */
export async function ProductSpecs({ p, compact = false }: { p: FieldProduct; compact?: boolean }) {
  const t = await getTranslations("library");
  const format = await getFormatter();
  const num = (v: string | number | null, unit: string, digits = 2) =>
    v === null || v === undefined ? null : `${format.number(Number(v), { maximumFractionDigits: digits })} ${unit}`.trim();
  const temps =
    p.min_application_temp_f !== null || p.max_application_temp_f !== null
      ? [p.min_application_temp_f !== null ? `${Number(p.min_application_temp_f)} °F` : "…", p.max_application_temp_f !== null ? `${Number(p.max_application_temp_f)} °F` : "…"].join(" – ")
      : null;
  const ratio = mixRatioLabel(p);
  const rows: { label: string; value: string | null; always: boolean }[] = [
    { label: t("fields.mix_ratio_a").replace(/, Part A|, Parte A/, ""), value: ratio ? `${ratio}${p.ratio_basis ? ` (${t(`basis.${p.ratio_basis}`).toLowerCase()})` : ""}` : null, always: true },
    { label: t("fields.kit_size_gal"), value: num(p.kit_size_gal, "gal"), always: true },
    { label: t("fields.recommended_coverage_sqft_per_gal"), value: num(p.recommended_coverage_sqft_per_gal, "SF/gal", 1), always: true },
    { label: t("fields.pot_life_minutes"), value: num(p.pot_life_minutes, "min", 0), always: true },
    { label: t("specsTemps"), value: temps, always: true },
    { label: t("fields.volume_solids_pct"), value: num(p.volume_solids_pct, "%", 1), always: false },
    { label: t("fields.recommended_wft_mils"), value: num(p.recommended_wft_mils, "mils"), always: false },
    { label: t("fields.recommended_dft_mils"), value: num(p.recommended_dft_mils, "mils"), always: false },
    { label: t("fields.max_rh_pct"), value: num(p.max_rh_pct, "%", 1), always: false },
    { label: t("fields.min_substrate_above_dew_point_f"), value: num(p.min_substrate_above_dew_point_f, "°F", 1), always: false },
  ];
  const shown = compact ? rows.filter((r) => r.always && r.value) : rows;
  if (shown.length === 0) return null;
  return (
    <dl className={compact ? "grid grid-cols-2 gap-x-4 gap-y-1" : "divide-y divide-neutral-200"}>
      {shown.map((r) => (
        <div key={r.label} className={compact ? "" : "grid grid-cols-[1fr_auto] gap-3 py-2"}>
          <dt className={compact ? "text-xs font-semibold uppercase tracking-wide text-neutral-600" : "text-base text-neutral-700"}>{r.label}</dt>
          <dd className={`${compact ? "text-sm" : "text-base text-right"} font-semibold ${r.value ? "text-neutral-950" : "font-normal text-neutral-500"}`}>
            {r.value ?? t("notSpecified")}
          </dd>
        </div>
      ))}
    </dl>
  );
}
