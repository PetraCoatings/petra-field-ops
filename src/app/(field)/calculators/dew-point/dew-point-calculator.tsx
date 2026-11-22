"use client";

import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, Droplets, OctagonAlert, RotateCcw, TriangleAlert } from "lucide-react";
import { formatNumber, parseDecimal } from "@/components/calculators/number";
import { NumberInput } from "@/components/calculators/number-input";
import { Segmented } from "@/components/calculators/segmented";
import { SaveToJob } from "@/components/calculators/save-to-job";
import { ShowTheMath } from "@/components/calculators/show-the-math";
import { usePersistedState } from "@/components/calculators/use-persisted-state";
import { ProductFill } from "@/components/calculators/product-fill";
import type { PickerProduct } from "@/lib/library/picker-types";
import { buttonClasses } from "@/components/ui/button-styles";
import {
  calculateDewPoint,
  cToF,
  dewPointC,
  fToC,
  magnusGamma,
  MAGNUS_A,
  MAGNUS_B_C,
  MAGNUS_VALID_MAX_C,
  MAGNUS_VALID_MIN_C,
  round1,
  toC,
  type TempUnit,
} from "@/domain/calculators/dew-point";

type Draft = { unit: TempUnit; air: string; rh: string; substrate: string; productId?: string };
const STORAGE_KEY = "petra.calc.dewPoint.v1";
const INITIAL: Draft = { unit: "F", air: "", rh: "", substrate: "" };

function isDraft(v: unknown): v is Draft {
  const d = v as Draft;
  return (
    typeof d === "object" &&
    d !== null &&
    (d.unit === "F" || d.unit === "C") &&
    typeof d.air === "string" &&
    typeof d.rh === "string" &&
    typeof d.substrate === "string"
  );
}

type FieldError = "number" | "rhRange";

function checkTemp(raw: string): { value?: number; error?: FieldError } {
  const n = parseDecimal(raw);
  if (n === null) return {};
  return Number.isFinite(n) ? { value: n } : { error: "number" };
}
function checkRh(raw: string): { value?: number; error?: FieldError } {
  const n = parseDecimal(raw.replace(/%\s*$/, ""));
  if (n === null) return {};
  if (!Number.isFinite(n)) return { error: "number" };
  return n > 0 && n <= 100 ? { value: n } : { error: "rhRange" };
}

/** Converts a typed reading when the unit is switched, so the crew doesn't retype it. */
function convertReading(raw: string, to: TempUnit): string {
  const n = parseDecimal(raw);
  if (n === null || !Number.isFinite(n)) return raw;
  return String(round1(to === "C" ? fToC(n) : cToF(n)));
}

export function DewPointCalculator({ marginF: companyMarginF, products = [] }: { marginF: number; products?: PickerProduct[] }) {
  const t = useTranslations("calculators.dewPoint");
  const tc = useTranslations("calculators");
  const locale = useLocale();
  const [draft, setDraft] = usePersistedState<Draft>(STORAGE_KEY, INITIAL, isDraft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const deg = `°${draft.unit}`;
  const fmt1 = (n: number) => formatNumber(locale, n, 1);
  // A product's own data sheet margin replaces the company margin.
  const product = products.find((p) => p.id === draft.productId);
  const productMargin = product?.dewPointMarginF ?? null;
  const marginF = productMargin ?? companyMarginF;

  const air = checkTemp(draft.air);
  const rh = checkRh(draft.rh);
  const substrate = checkTemp(draft.substrate);

  const result =
    air.value !== undefined && rh.value !== undefined && !substrate.error
      ? calculateDewPoint({
          unit: draft.unit,
          airTemp: air.value,
          relativeHumidity: rh.value,
          substrateTemp: substrate.value,
          marginF,
        })
      : null;

  const saveInputs = result
    ? { unit: draft.unit, airTemp: air.value, relativeHumidity: rh.value, substrateTemp: substrate.value, productId: product?.id }
    : null;

  const switchUnit = (unit: TempUnit) => {
    if (unit === draft.unit) return;
    setDraft((d) => ({
      ...d,
      unit,
      air: convertReading(d.air, unit),
      substrate: convertReading(d.substrate, unit),
    }));
  };

  const status = result?.status;
  const statusStyles = {
    ok: { box: "border-green-700 bg-green-50 text-green-950", Icon: CircleCheck, icon: "text-green-700" },
    belowMargin: { box: "border-accent-600 bg-amber-50 text-amber-950", Icon: TriangleAlert, icon: "text-amber-700" },
    condensation: { box: "border-red-700 bg-red-50 text-red-950", Icon: OctagonAlert, icon: "text-red-700" },
  } as const;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <ProductFill
          products={products}
          value={product?.id ?? ""}
          relevant={() => true}
          showHint={false}
          onPick={(p) => set({ productId: p?.id })}
        />
        <Segmented
          label={t("unit")}
          value={draft.unit}
          onChange={switchUnit}
          options={[
            { value: "F", label: "°F" },
            { value: "C", label: "°C" },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberInput
            id="dp-air"
            label={t("airTemp")}
            suffix={deg}
            value={draft.air}
            onChange={(air) => set({ air })}
            error={air.error && t(`errors.${air.error}`)}
            belowZeroLabel={t("belowZero")}
          />
          <NumberInput
            id="dp-rh"
            label={t("humidity")}
            suffix="%"
            value={draft.rh}
            onChange={(rh) => set({ rh })}
            error={rh.error && t(`errors.${rh.error}`)}
          />
          <NumberInput
            id="dp-substrate"
            label={t("substrateTemp")}
            suffix={deg}
            value={draft.substrate}
            onChange={(substrate) => set({ substrate })}
            error={substrate.error && t(`errors.${substrate.error}`)}
            help={t("substrateHelp")}
            belowZeroLabel={t("belowZero")}
          />
        </div>
      </div>

      <section aria-labelledby="dp-result" aria-live="polite" className="space-y-3">
        <div className="rounded-2xl border-2 border-brand-700 bg-brand-800 p-4 text-white shadow-lg">
          <h2 id="dp-result" className="text-sm font-semibold uppercase tracking-wide text-brand-100">
            {t("dewPoint")}
          </h2>
          {result ? (
            <>
              <p className="text-4xl font-bold tabular-nums">
                {fmt1(result.dewPoint)} <span className="text-2xl">{deg}</span>
              </p>
              <p className="text-base text-brand-100 tabular-nums">
                {t("minimumSubstrate", { temp: `${fmt1(result.minimumSubstrate)} ${deg}`, margin: `${fmt1(result.margin)} ${deg}` })}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-2 py-2 text-lg text-brand-100">
              <Droplets aria-hidden className="size-6" />
              {t("enterReadings")}
            </p>
          )}
        </div>

        {result && status && result.spread !== undefined && (
          <div className={`flex gap-3 rounded-2xl border-l-8 p-4 ${statusStyles[status].box}`} role={status === "ok" ? "status" : "alert"}>
            {(() => {
              const { Icon, icon } = statusStyles[status];
              return <Icon aria-hidden className={`size-8 shrink-0 ${icon}`} />;
            })()}
            <div>
              <p className="text-xl font-bold">{t(`status.${status}.title`)}</p>
              <p className="text-base">
                {t(`status.${status}.body`, {
                  spread: `${fmt1(Math.abs(result.spread))} ${deg}`,
                  margin: `${fmt1(result.margin)} ${deg}`,
                })}
              </p>
            </div>
          </div>
        )}

        {result?.outsideFormulaRange && (
          <p className="rounded-xl border-l-4 border-accent-600 bg-amber-50 px-4 py-3 text-base font-medium text-amber-950">
            {t("outsideRange")}
          </p>
        )}

        <p className="text-sm text-neutral-700">
          {productMargin !== null && product
            ? t("productMarginNote", { product: product.name, margin: `${formatNumber(locale, marginF, marginF % 1 === 0 ? 0 : 1)} °F` })
            : t("marginNote", { margin: `${formatNumber(locale, marginF, marginF % 1 === 0 ? 0 : 1)} °F` })}
        </p>
      </section>

      <SaveToJob type="dew_point" inputs={saveInputs} />

      <ShowTheMath label={tc("showTheMath")}>
        {result ? (
          (() => {
            const airC = toC(air.value!, draft.unit);
            const gamma = magnusGamma(airC, rh.value!);
            const dewC = dewPointC(airC, rh.value!);
            const n = (x: number, d = 4) => formatNumber(locale, x, d);
            return (
              <>
                <p className="font-sans">{t("math.formula")}</p>
                {draft.unit === "F" && (
                  <p>
                    T = ({n(air.value!, 1)} − 32) × 5/9 = {n(airC)} °C
                  </p>
                )}
                <p>
                  γ = ln({n(rh.value!, 1)}/100) + {MAGNUS_A} × {n(airC)} / ({MAGNUS_B_C} + {n(airC)}) = {n(gamma)}
                </p>
                <p>
                  Td = {MAGNUS_B_C} × {n(gamma)} / ({MAGNUS_A} − {n(gamma)}) = {n(dewC)} °C
                </p>
                {draft.unit === "F" && (
                  <p>
                    Td = {n(dewC)} × 9/5 + 32 = {n(result.dewPointExact)} °F
                  </p>
                )}
                <p>
                  ≈ {fmt1(result.dewPoint)} {deg}
                </p>
                <p className="border-t border-neutral-200 pt-2">
                  {t("math.minimum")}: {fmt1(result.dewPoint)} + {fmt1(result.margin)} = {fmt1(result.minimumSubstrate)} {deg}
                </p>
                {result.spread !== undefined && (
                  <p>
                    {t("math.spread")}: {fmt1(substrate.value!)} − {fmt1(result.dewPoint)} = {fmt1(result.spread)} {deg}
                  </p>
                )}
                <p className="font-sans text-neutral-600">
                  {t("math.source", { min: MAGNUS_VALID_MIN_C, max: MAGNUS_VALID_MAX_C })}
                </p>
              </>
            );
          })()
        ) : (
          <p>{t("enterReadings")}</p>
        )}
      </ShowTheMath>

      <button type="button" onClick={() => setDraft({ ...INITIAL, unit: draft.unit })} className={buttonClasses("ghost", "md")}>
        <RotateCcw aria-hidden className="size-5" />
        {tc("startOver")}
      </button>
    </div>
  );
}
