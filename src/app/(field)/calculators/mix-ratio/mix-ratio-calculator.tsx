"use client";

import { useLocale, useTranslations } from "next-intl";
import { FlaskConical, RotateCcw } from "lucide-react";
import { formatNumber, parseDecimal } from "@/components/calculators/number";
import { NumberInput } from "@/components/calculators/number-input";
import { Segmented } from "@/components/calculators/segmented";
import { SaveToJob } from "@/components/calculators/save-to-job";
import { ShowTheMath } from "@/components/calculators/show-the-math";
import { usePersistedState } from "@/components/calculators/use-persisted-state";
import { buttonClasses } from "@/components/ui/button-styles";
import {
  calculateMix,
  combineUnits,
  smallPerLarge,
  splitUnits,
  type KnownAmount,
  type MixBasis,
} from "@/domain/calculators/mix-ratio";

type Draft = { basis: MixBasis; ratioA: string; ratioB: string; known: KnownAmount; large: string; small: string };
const STORAGE_KEY = "petra.calc.mixRatio.v1";
const INITIAL: Draft = { basis: "volume", ratioA: "", ratioB: "", known: "total", large: "", small: "" };

function isDraft(v: unknown): v is Draft {
  const d = v as Draft;
  return (
    typeof d === "object" &&
    d !== null &&
    (d.basis === "volume" || d.basis === "weight") &&
    (d.known === "total" || d.known === "a" || d.known === "b") &&
    ["ratioA", "ratioB", "large", "small"].every((k) => typeof d[k as keyof Draft] === "string")
  );
}

type Checked = { value?: number; error?: "number" | "positive" | "notNegative" };

function positiveField(raw: string): Checked {
  const n = parseDecimal(raw);
  if (n === null) return {};
  if (!Number.isFinite(n)) return { error: "number" };
  return n > 0 ? { value: n } : { error: "positive" };
}
function nonNegativeField(raw: string): Checked {
  const n = parseDecimal(raw);
  if (n === null) return {};
  if (!Number.isFinite(n)) return { error: "number" };
  return n >= 0 ? { value: n } : { error: "notNegative" };
}

export function MixRatioCalculator() {
  const t = useTranslations("calculators.mixRatio");
  const tc = useTranslations("calculators");
  const locale = useLocale();
  const [draft, setDraft] = usePersistedState<Draft>(STORAGE_KEY, INITIAL, isDraft);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const f = (n: number, d = 1) => formatNumber(locale, n, d);

  const isVolume = draft.basis === "volume";
  const largeUnit = isVolume ? tc("galUnit") : tc("lbUnit");
  const smallUnit = isVolume ? tc("flOzUnit") : tc("ozUnit");

  const ra = positiveField(draft.ratioA);
  const rb = positiveField(draft.ratioB);
  const large = nonNegativeField(draft.large);
  const small = nonNegativeField(draft.small);
  const err = (c: Checked) => (c.error ? t(`errors.${c.error}`) : undefined);

  const amount =
    (large.value !== undefined || small.value !== undefined) && !large.error && !small.error
      ? combineUnits(large.value ?? 0, small.value ?? 0, draft.basis)
      : undefined;
  const result =
    ra.value !== undefined && rb.value !== undefined && amount !== undefined && amount > 0
      ? calculateMix({ ratioA: ra.value, ratioB: rb.value, known: draft.known, amount })
      : null;

  const saveInputs = result
    ? { basis: draft.basis, ratioA: ra.value, ratioB: rb.value, known: draft.known, amount }
    : null;

  const both = (smallAmount: number) => {
    const s = splitUnits(smallAmount, draft.basis);
    return s.large > 0 ? `${s.large} ${largeUnit} ${f(s.small)} ${smallUnit}` : `${f(s.small)} ${smallUnit}`;
  };
  const amountLabel = t(`amountFor.${draft.known}`);

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <Segmented
          label={t("basis")}
          value={draft.basis}
          onChange={(basis) => set({ basis })}
          options={[
            { value: "volume", label: t("bases.volume") },
            { value: "weight", label: t("bases.weight") },
          ]}
        />
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-neutral-800">{t("ratio")}</legend>
          <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2">
            <NumberInput id="mr-a" label={t("partA")} suffix="" value={draft.ratioA} onChange={(v) => set({ ratioA: v })} error={err(ra)} />
            <span aria-hidden className="pt-9 text-2xl font-bold text-neutral-700">
              :
            </span>
            <NumberInput id="mr-b" label={t("partB")} suffix="" value={draft.ratioB} onChange={(v) => set({ ratioB: v })} error={err(rb)} />
          </div>
          <p className="mt-1 text-sm text-neutral-600">{t("ratioHelp")}</p>
        </fieldset>

        <Segmented
          label={t("known")}
          value={draft.known}
          onChange={(known) => set({ known })}
          options={[
            { value: "total", label: t("knownOptions.total") },
            { value: "a", label: t("knownOptions.a") },
            { value: "b", label: t("knownOptions.b") },
          ]}
          size="sm"
        />
        <fieldset>
          <legend className="mb-1 text-sm font-semibold text-neutral-800">{amountLabel}</legend>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput
              id="mr-large"
              label={`${amountLabel}, ${largeUnit}`}
              suffix={largeUnit}
              labelHidden
              value={draft.large}
              onChange={(v) => set({ large: v })}
              error={err(large)}
            />
            <NumberInput
              id="mr-small"
              label={`${amountLabel}, ${smallUnit}`}
              suffix={smallUnit}
              labelHidden
              value={draft.small}
              onChange={(v) => set({ small: v })}
              error={err(small)}
            />
          </div>
        </fieldset>
      </div>

      <section aria-labelledby="mr-result" aria-live="polite" className="space-y-3 rounded-2xl border-2 border-brand-700 bg-brand-800 p-4 text-white shadow-lg">
        <h2 id="mr-result" className="text-sm font-semibold uppercase tracking-wide text-brand-100">
          {t("result", { basis: t(`bases.${draft.basis}`).toLowerCase() })}
        </h2>
        {result ? (
          <>
            <dl className="grid grid-cols-2 gap-3">
              {(["a", "b"] as const).map((part) => (
                <div key={part} className="rounded-xl bg-white/10 p-3">
                  <dt className="text-sm font-semibold text-brand-100">{part === "a" ? t("partA") : t("partB")}</dt>
                  <dd className="text-2xl font-bold tabular-nums">{both(result[part])}</dd>
                  {result[part] >= smallPerLarge(draft.basis) && (
                    <dd className="text-sm text-brand-100 tabular-nums">
                      = {f(result[part])} {smallUnit}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
            <p className="text-lg font-semibold tabular-nums">{t("total", { amount: both(result.total) })}</p>
          </>
        ) : (
          <p className="flex items-center gap-2 py-2 text-lg text-brand-100">
            <FlaskConical aria-hidden className="size-6 shrink-0" />
            {t("enterInputs")}
          </p>
        )}
      </section>

      <p className="rounded-xl border-l-4 border-accent-600 bg-amber-50 px-4 py-3 text-base font-medium text-amber-950">
        {isVolume ? t("warnings.volume") : t("warnings.weight")}
      </p>

      <SaveToJob type="mix_ratio" inputs={saveInputs} />

      <ShowTheMath label={tc("showTheMath")}>
        {result && ra.value !== undefined && rb.value !== undefined && amount !== undefined ? (
          <>
            {large.value ? (
              <p>
                {f(large.value, 2)} × {smallPerLarge(draft.basis)} + {f(small.value ?? 0)} = {f(amount, 2)} {smallUnit}
              </p>
            ) : null}
            {draft.known === "total" ? (
              <>
                <p>
                  A = {f(amount, 2)} × {f(ra.value, 2)} ÷ ({f(ra.value, 2)} + {f(rb.value, 2)}) = {f((amount * ra.value) / (ra.value + rb.value), 3)} → {f(result.a)}
                </p>
                <p>
                  B = {f(amount, 2)} × {f(rb.value, 2)} ÷ ({f(ra.value, 2)} + {f(rb.value, 2)}) = {f((amount * rb.value) / (ra.value + rb.value), 3)} → {f(result.b)}
                </p>
              </>
            ) : draft.known === "a" ? (
              <p>
                B = {f(result.a)} × {f(rb.value, 2)} ÷ {f(ra.value, 2)} = {f((result.a * rb.value) / ra.value, 3)} → {f(result.b)}
              </p>
            ) : (
              <p>
                A = {f(result.b)} × {f(ra.value, 2)} ÷ {f(rb.value, 2)} = {f((result.b * ra.value) / rb.value, 3)} → {f(result.a)}
              </p>
            )}
            <p>
              {f(result.a)} + {f(result.b)} = {f(result.total)} {smallUnit}
            </p>
            <p className="font-sans text-neutral-600">{t("math.note", { unit: smallUnit, per: smallPerLarge(draft.basis), large: largeUnit })}</p>
          </>
        ) : (
          <p>{t("enterInputs")}</p>
        )}
      </ShowTheMath>

      <button type="button" onClick={() => setDraft({ ...INITIAL, basis: draft.basis })} className={buttonClasses("ghost", "md")}>
        <RotateCcw aria-hidden className="size-5" />
        {tc("startOver")}
      </button>
    </div>
  );
}
