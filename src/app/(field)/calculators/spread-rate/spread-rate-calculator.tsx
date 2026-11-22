"use client";

import { useLocale, useTranslations } from "next-intl";
import { Layers, RotateCcw } from "lucide-react";
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
  fromMils,
  fromSpreadRate,
  IN3_PER_GALLON,
  IN3_PER_SQFT_MIL,
  SQFT_MILS_PER_GALLON,
  type FilmBasis,
} from "@/domain/calculators/spread-rate";

type Mode = "fromRate" | "fromMils";
type Draft = { mode: Mode; basis: FilmBasis; rate: string; mils: string; solids: string; loss: string; productId?: string };
const STORAGE_KEY = "petra.calc.spreadRate.v1";
const INITIAL: Draft = { mode: "fromRate", basis: "wft", rate: "", mils: "", solids: "", loss: "" };

function isDraft(v: unknown): v is Draft {
  const d = v as Draft;
  return (
    typeof d === "object" &&
    d !== null &&
    (d.mode === "fromRate" || d.mode === "fromMils") &&
    (d.basis === "wft" || d.basis === "dft") &&
    ["rate", "mils", "solids", "loss"].every((k) => typeof d[k as keyof Draft] === "string")
  );
}

type ErrorKey = "number" | "positive" | "solidsRange" | "lossRange";
type Checked = { value?: number; error?: ErrorKey };

function check(raw: string, valid: (n: number) => boolean, rangeError: ErrorKey, stripPercent = false): Checked {
  const n = parseDecimal(stripPercent ? raw.replace(/%\s*$/, "") : raw);
  if (n === null) return {};
  if (!Number.isFinite(n)) return { error: "number" };
  return valid(n) ? { value: n } : { error: rangeError };
}

const str = (n: number | null) => (n === null ? undefined : String(n));

export function SpreadRateCalculator({ products = [] }: { products?: PickerProduct[] }) {
  const t = useTranslations("calculators.spreadRate");
  const tc = useTranslations("calculators");
  const locale = useLocale();
  const [draft, setDraft] = usePersistedState<Draft>(STORAGE_KEY, INITIAL, isDraft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const f = (n: number, d: number) => formatNumber(locale, n, d);

  const rate = check(draft.rate, (n) => n > 0, "positive");
  const mils = check(draft.mils, (n) => n > 0, "positive");
  const solids = check(draft.solids, (n) => n > 0 && n <= 100, "solidsRange", true);
  const loss = check(draft.loss, (n) => n >= 0 && n < 100, "lossRange", true);
  const err = (c: Checked) => (c.error ? t(`errors.${c.error}`) : undefined);

  const needsSolids = draft.mode === "fromMils" && draft.basis === "dft" && solids.value === undefined && !solids.error;

  const rateResult =
    draft.mode === "fromRate" && rate.value !== undefined && !solids.error
      ? fromSpreadRate({ spreadRate: rate.value, volumeSolidsPct: solids.value })
      : null;
  const milsResult =
    draft.mode === "fromMils" && mils.value !== undefined && !solids.error && !loss.error && !needsSolids
      ? fromMils({ mils: mils.value, basis: draft.basis, volumeSolidsPct: solids.value, lossPct: loss.value })
      : null;

  const saveInputs = rateResult
    ? { mode: "fromRate", spreadRate: rate.value, volumeSolidsPct: solids.value }
    : milsResult
      ? { mode: "fromMils", mils: mils.value, basis: draft.basis, volumeSolidsPct: solids.value, lossPct: loss.value }
      : null;

  const K = f(SQFT_MILS_PER_GALLON, 2);
  const sf = tc("sqftPerGalUnit");

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <ProductFill
          products={products}
          value={draft.productId ?? ""}
          relevant={(p) => p.volumeSolids !== null || p.coverage !== null || p.wftMils !== null || p.dftMils !== null}
          onPick={(p) =>
            setDraft((d) => {
              if (!p) return { ...d, productId: undefined };
              const film = p.wftMils !== null ? { basis: "wft" as const, mils: String(p.wftMils) } : p.dftMils !== null ? { basis: "dft" as const, mils: String(p.dftMils) } : {};
              return { ...d, productId: p.id, ...film, rate: str(p.coverage) ?? d.rate, solids: str(p.volumeSolids) ?? d.solids };
            })
          }
        />
        <Segmented
          label={t("mode")}
          value={draft.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: "fromRate", label: t("modes.fromRate") },
            { value: "fromMils", label: t("modes.fromMils") },
          ]}
        />
        {draft.mode === "fromRate" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <NumberInput id="sr-rate" label={t("spreadRate")} suffix={sf} value={draft.rate} onChange={(rate) => set({ rate })} error={err(rate)} />
            <NumberInput
              id="sr-solids"
              label={t("volumeSolids")}
              suffix="%"
              value={draft.solids}
              onChange={(solids) => set({ solids })}
              error={err(solids)}
              help={t("volumeSolidsHelp")}
            />
          </div>
        ) : (
          <>
            <Segmented
              label={t("basis")}
              value={draft.basis}
              onChange={(basis) => set({ basis })}
              options={[
                { value: "wft", label: t("bases.wft") },
                { value: "dft", label: t("bases.dft") },
              ]}
              size="sm"
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <NumberInput
                id="sr-mils"
                label={draft.basis === "wft" ? t("wftTarget") : t("dftTarget")}
                suffix={tc("milsUnit")}
                value={draft.mils}
                onChange={(m) => set({ mils: m })}
                error={err(mils)}
              />
              <NumberInput
                id="sr-solids"
                label={t("volumeSolids")}
                suffix="%"
                value={draft.solids}
                onChange={(solids) => set({ solids })}
                error={err(solids)}
                help={draft.basis === "dft" ? t("volumeSolidsRequired") : t("volumeSolidsHelp")}
              />
              <NumberInput
                id="sr-loss"
                label={t("loss")}
                suffix="%"
                value={draft.loss}
                onChange={(l) => set({ loss: l })}
                error={err(loss)}
                help={t("lossHelp")}
              />
            </div>
          </>
        )}
      </div>

      <section aria-labelledby="sr-result" aria-live="polite" className="space-y-2 rounded-2xl border-2 border-brand-700 bg-brand-800 p-4 text-white shadow-lg">
        {draft.mode === "fromRate" ? (
          <>
            <h2 id="sr-result" className="text-sm font-semibold uppercase tracking-wide text-brand-100">
              {t("wetFilm")}
            </h2>
            {rateResult ? (
              <>
                <p className="text-4xl font-bold tabular-nums">
                  {f(rateResult.wft, 2)} <span className="text-2xl">{tc("milsUnit")}</span>
                </p>
                <p className="text-base text-brand-100 tabular-nums">
                  {rateResult.dft !== undefined
                    ? t("dryFilmIs", { dft: f(rateResult.dft, 2) })
                    : t("dryFilmNeedsSolids")}
                </p>
              </>
            ) : (
              <Prompt text={t("enterRate")} />
            )}
          </>
        ) : (
          <>
            <h2 id="sr-result" className="text-sm font-semibold uppercase tracking-wide text-brand-100">
              {t("theoreticalCoverage")}
            </h2>
            {milsResult ? (
              <>
                <p className="text-4xl font-bold tabular-nums">
                  {f(milsResult.spreadRate, 1)} <span className="text-2xl">{sf}</span>
                </p>
                {milsResult.practicalSpreadRate !== undefined && (
                  <p className="text-xl font-semibold tabular-nums">
                    {t("practicalIs", { rate: f(milsResult.practicalSpreadRate, 1), loss: f(loss.value!, loss.value! % 1 ? 1 : 0) })}
                  </p>
                )}
                <p className="text-base text-brand-100 tabular-nums">
                  {t("wetDry", {
                    wft: f(milsResult.wft, 2),
                    dft: milsResult.dft !== undefined ? `${f(milsResult.dft, 2)} ${tc("milsUnit")}` : t("notSpecified"),
                  })}
                </p>
              </>
            ) : (
              <Prompt text={needsSolids && mils.value !== undefined ? t("volumeSolidsRequired") : t("enterMils")} />
            )}
          </>
        )}
      </section>

      <SaveToJob type="spread_rate" inputs={saveInputs} />

      <ShowTheMath label={tc("showTheMath")}>
        <p className="font-sans">{t("math.constant", { gal: IN3_PER_GALLON, sqftMil: IN3_PER_SQFT_MIL, k: K })}</p>
        {rateResult && rate.value !== undefined && (
          <>
            <p>
              WFT = {K} ÷ {f(rate.value, 1)} = {f(rateResult.wft, 4)} ≈ {f(rateResult.wft, 2)} mils
            </p>
            {rateResult.dft !== undefined && (
              <p>
                DFT = {f(rateResult.wft, 4)} × {f(solids.value!, 1)}% = {f(rateResult.dft, 4)} ≈ {f(rateResult.dft, 2)} mils
              </p>
            )}
          </>
        )}
        {milsResult && mils.value !== undefined && (
          <>
            {draft.basis === "dft" && (
              <p>
                WFT = {f(mils.value, 2)} ÷ {f(solids.value!, 1)}% = {f(milsResult.wft, 4)} mils
              </p>
            )}
            {draft.basis === "wft" && milsResult.dft !== undefined && (
              <p>
                DFT = {f(milsResult.wft, 2)} × {f(solids.value!, 1)}% = {f(milsResult.dft, 4)} mils
              </p>
            )}
            <p>
              {t("math.theoretical")} = {K} ÷ {f(milsResult.wft, 4)} = {f(milsResult.spreadRate, 4)} ≈ {f(milsResult.spreadRate, 1)} {sf}
            </p>
            {milsResult.practicalSpreadRate !== undefined && (
              <p>
                {t("math.practical")} = {f(milsResult.spreadRate, 4)} × (1 − {f(loss.value!, 1)}%) = {f(milsResult.practicalSpreadRate, 4)} ≈{" "}
                {f(milsResult.practicalSpreadRate, 1)} {sf}
              </p>
            )}
          </>
        )}
        <p className="font-sans text-neutral-600">{t("math.note")}</p>
      </ShowTheMath>

      <button type="button" onClick={() => setDraft({ ...INITIAL, mode: draft.mode })} className={buttonClasses("ghost", "md")}>
        <RotateCcw aria-hidden className="size-5" />
        {tc("startOver")}
      </button>
    </div>
  );
}

function Prompt({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 py-2 text-lg text-brand-100">
      <Layers aria-hidden className="size-6 shrink-0" />
      {text}
    </p>
  );
}
