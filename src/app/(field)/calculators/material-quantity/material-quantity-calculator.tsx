"use client";

import { useLocale, useTranslations } from "next-intl";
import { PaintBucket, RotateCcw } from "lucide-react";
import { formatNumber, parseDecimal } from "@/components/calculators/number";
import { NumberInput } from "@/components/calculators/number-input";
import { Segmented } from "@/components/calculators/segmented";
import { SaveToJob } from "@/components/calculators/save-to-job";
import { ShowTheMath } from "@/components/calculators/show-the-math";
import { usePersistedState } from "@/components/calculators/use-persisted-state";
import { ProductFill } from "@/components/calculators/product-fill";
import type { PickerProduct } from "@/lib/library/picker-types";
import { buttonClasses } from "@/components/ui/button-styles";
import { calculateMaterial, spreadRateForWftMils } from "@/domain/calculators/material";
import { SQFT_MILS_PER_GALLON } from "@/domain/calculators/spread-rate";

type CoverageMode = "rate" | "mils";
type Draft = { area: string; coverageMode: CoverageMode; coverage: string; coats: string; waste: string; kit: string; productId?: string };
const STORAGE_KEY = "petra.calc.materialQuantity.v1";
const INITIAL: Draft = { area: "", coverageMode: "rate", coverage: "", coats: "1", waste: "", kit: "" };

function isDraft(v: unknown): v is Draft {
  const d = v as Draft;
  return (
    typeof d === "object" &&
    d !== null &&
    (d.coverageMode === "rate" || d.coverageMode === "mils") &&
    ["area", "coverage", "coats", "waste", "kit"].every((k) => typeof d[k as keyof Draft] === "string")
  );
}

type ErrorKey = "number" | "positive" | "coats" | "wasteRange";
type Checked = { value?: number; error?: ErrorKey };

function check(raw: string, valid: (n: number) => boolean, rangeError: ErrorKey): Checked {
  const n = parseDecimal(raw.replace(/%\s*$/, ""));
  if (n === null) return {};
  if (!Number.isFinite(n)) return { error: "number" };
  return valid(n) ? { value: n } : { error: rangeError };
}

const str = (n: number | null) => (n === null ? undefined : String(n));

export function MaterialQuantityCalculator({ products = [] }: { products?: PickerProduct[] }) {
  const t = useTranslations("calculators.materialQuantity");
  const tc = useTranslations("calculators");
  const locale = useLocale();
  const [draft, setDraft] = usePersistedState<Draft>(STORAGE_KEY, INITIAL, isDraft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const f = (n: number, d = 2) => formatNumber(locale, n, d);

  const area = check(draft.area, (n) => n > 0, "positive");
  const coverage = check(draft.coverage, (n) => n > 0, "positive");
  const coats = check(draft.coats, (n) => Number.isInteger(n) && n >= 1, "coats");
  const waste = check(draft.waste, (n) => n >= 0 && n < 100, "wasteRange");
  const kit = check(draft.kit, (n) => n > 0, "positive");
  const err = (c: Checked) => (c.error ? t(`errors.${c.error}`) : undefined);

  const spreadRate =
    coverage.value === undefined ? undefined : draft.coverageMode === "rate" ? coverage.value : spreadRateForWftMils(coverage.value);
  const ready =
    area.value !== undefined && spreadRate !== undefined && coats.value !== undefined && waste.value !== undefined && !kit.error;
  const result = ready
    ? calculateMaterial({
        areaSqft: area.value!,
        spreadRate: spreadRate!,
        coats: coats.value!,
        wastePct: waste.value!,
        kitGallons: kit.value,
      })
    : null;
  const saveInputs = result
    ? {
        areaSqft: area.value,
        coverage:
          draft.coverageMode === "rate" ? { mode: "rate", spreadRate: coverage.value } : { mode: "mils", wftMils: coverage.value },
        coats: coats.value,
        wastePct: waste.value,
        kitGallons: kit.value,
      }
    : null;
  const missingWasteOnly =
    !result && area.value !== undefined && spreadRate !== undefined && coats.value !== undefined && waste.value === undefined && !waste.error;
  const pct = (n: number) => f(n, n % 1 ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <ProductFill
          products={products}
          value={draft.productId ?? ""}
          relevant={(p) => p.coverage !== null || p.kitSizeGal !== null}
          onPick={(p) =>
            setDraft((d) => {
              if (!p) return { ...d, productId: undefined };
              return { ...d, productId: p.id, ...(p.coverage !== null && { coverageMode: "rate" as const, coverage: String(p.coverage) }), kit: str(p.kitSizeGal) ?? d.kit };
            })
          }
        />
        <NumberInput id="mq-area" label={t("area")} suffix={tc("sqftUnit")} value={draft.area} onChange={(v) => set({ area: v })} error={err(area)} />
        <Segmented
          label={t("coverageMode")}
          value={draft.coverageMode}
          onChange={(coverageMode) => set({ coverageMode, coverage: "" })}
          options={[
            { value: "rate", label: t("coverageModes.rate") },
            { value: "mils", label: t("coverageModes.mils") },
          ]}
          size="sm"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberInput
            id="mq-coverage"
            label={draft.coverageMode === "rate" ? t("spreadRate") : t("wetMils")}
            suffix={draft.coverageMode === "rate" ? tc("sqftPerGalUnit") : tc("milsUnit")}
            value={draft.coverage}
            onChange={(v) => set({ coverage: v })}
            error={err(coverage)}
            help={draft.coverageMode === "rate" ? t("perCoat") : undefined}
          />
          <NumberInput id="mq-coats" label={t("coats")} suffix="" value={draft.coats} onChange={(v) => set({ coats: v })} error={err(coats)} />
          <NumberInput
            id="mq-waste"
            label={t("waste")}
            suffix="%"
            value={draft.waste}
            onChange={(v) => set({ waste: v })}
            error={err(waste)}
            help={t("wasteHelp")}
          />
          <NumberInput
            id="mq-kit"
            label={t("kitSize")}
            suffix={tc("galUnit")}
            value={draft.kit}
            onChange={(v) => set({ kit: v })}
            error={err(kit)}
            help={t("kitHelp")}
          />
        </div>
      </div>

      <section aria-labelledby="mq-result" aria-live="polite" className="space-y-2 rounded-2xl border-2 border-brand-700 bg-brand-800 p-4 text-white shadow-lg">
        <h2 id="mq-result" className="text-sm font-semibold uppercase tracking-wide text-brand-100">
          {t("totalNeeded")}
        </h2>
        {result ? (
          <>
            <p className="text-4xl font-bold tabular-nums">
              {f(result.totalGallons)} <span className="text-2xl">{tc("galUnit")}</span>
            </p>
            <p className="text-base text-brand-100 tabular-nums">
              {t("breakdown", { base: f(result.baseGallons), waste: f(result.wasteGallons), pct: pct(waste.value!) })}
            </p>
            {result.kits !== undefined && (
              <p className="text-xl font-semibold tabular-nums">
                {t("kits", { count: result.kits, size: f(kit.value!, kit.value! % 1 ? 2 : 0), leftover: f(result.leftoverGallons!) })}
              </p>
            )}
          </>
        ) : (
          <p className="flex items-center gap-2 py-2 text-lg text-brand-100">
            <PaintBucket aria-hidden className="size-6 shrink-0" />
            {missingWasteOnly ? t("enterWaste") : t("enterInputs")}
          </p>
        )}
      </section>

      <SaveToJob type="material_quantity" inputs={saveInputs} />

      <ShowTheMath label={tc("showTheMath")}>
        {result ? (
          <>
            {draft.coverageMode === "mils" && (
              <p>
                {t("math.rate")} = {f(SQFT_MILS_PER_GALLON)} ÷ {f(coverage.value!)} = {f(spreadRate!, 4)} {tc("sqftPerGalUnit")}
              </p>
            )}
            <p>
              {f(area.value!)} {tc("sqftUnit")} × {coats.value} ÷ {f(spreadRate!, draft.coverageMode === "mils" ? 4 : 2)} = {f(result.baseGallons, 4)}{" "}
              {tc("galUnit")}
            </p>
            <p>
              {t("math.waste")}: {f(result.baseGallons, 4)} × {pct(waste.value!)}% = {f(result.wasteGallons, 4)} {tc("galUnit")}
            </p>
            <p>
              {f(result.baseGallons, 4)} + {f(result.wasteGallons, 4)} = {f(result.totalGallons, 4)} {tc("galUnit")}
            </p>
            {result.kits !== undefined && (
              <p>
                {f(result.totalGallons, 4)} ÷ {f(kit.value!)} = {f(result.totalGallons / kit.value!, 4)} → {result.kits}
              </p>
            )}
            <p className="font-sans text-neutral-600">{t("math.note")}</p>
          </>
        ) : (
          <p>{t("enterInputs")}</p>
        )}
      </ShowTheMath>

      <button type="button" onClick={() => setDraft(INITIAL)} className={buttonClasses("ghost", "md")}>
        <RotateCcw aria-hidden className="size-5" />
        {tc("startOver")}
      </button>
    </div>
  );
}
