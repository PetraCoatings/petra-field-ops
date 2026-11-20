"use client";

import { useLocale, useTranslations } from "next-intl";
import { Minus, Plus, RotateCcw, Trash2 } from "lucide-react";
import { formatNumber } from "@/components/calculators/number";
import { Segmented } from "@/components/calculators/segmented";
import { ShowTheMath } from "@/components/calculators/show-the-math";
import { usePersistedState } from "@/components/calculators/use-persisted-state";
import { buttonClasses } from "@/components/ui/button-styles";
import {
  calculateArea,
  SQFT_PER_SQM,
  SQFT_PER_SQYD,
  type AreaInput,
  type AreaOperation,
  type AreaShape,
} from "@/domain/calculators/area";
import { formatFeetInches, parseFeetAndInches, type LengthError } from "@/domain/calculators/length";

type Dim = { ft: string; in: string };
type AreaDraft = {
  id: string;
  name: string;
  shape: AreaShape;
  operation: AreaOperation;
  quantity: string;
  a: Dim; // length · base · diameter
  b: Dim; // width · height (unused for circles)
};

const STORAGE_KEY = "petra.calc.squareFootage.v1";
const SHAPES: readonly AreaShape[] = ["rectangle", "triangle", "circle"];
const EMPTY_DIM: Dim = { ft: "", in: "" };

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function newArea(operation: AreaOperation): AreaDraft {
  return { id: newId(), name: "", shape: "rectangle", operation, quantity: "1", a: EMPTY_DIM, b: EMPTY_DIM };
}

const initialAreas = (): AreaDraft[] => [newArea("add")];

function isDim(v: unknown): v is Dim {
  return typeof v === "object" && v !== null && typeof (v as Dim).ft === "string" && typeof (v as Dim).in === "string";
}
function isDrafts(v: unknown): v is AreaDraft[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every(
      (d) =>
        typeof d?.id === "string" &&
        typeof d.name === "string" &&
        SHAPES.includes(d.shape) &&
        (d.operation === "add" || d.operation === "subtract") &&
        typeof d.quantity === "string" &&
        isDim(d.a) &&
        isDim(d.b),
    )
  );
}

type DimCheck = { feet: number } | { error: Exclude<LengthError, "empty"> | "zero" } | { empty: true };

function checkDim(d: Dim): DimCheck {
  const r = parseFeetAndInches(d.ft, d.in);
  if (!r.ok) return r.error === "empty" ? { empty: true } : { error: r.error };
  return r.feet > 0 ? { feet: r.feet } : { error: "zero" };
}

type QtyCheck = { quantity: number } | { error: "quantity" };
function checkQuantity(raw: string): QtyCheck {
  const s = raw.trim();
  if (s === "") return { quantity: 1 };
  return /^\d+$/.test(s) && Number(s) >= 1 ? { quantity: Number(s) } : { error: "quantity" };
}

/** Turns a draft into a calculator input, or null while it's incomplete or invalid. */
function toInput(d: AreaDraft): AreaInput | null {
  const q = checkQuantity(d.quantity);
  const a = checkDim(d.a);
  if (!("quantity" in q) || !("feet" in a)) return null;
  if (d.shape === "circle") return { shape: "circle", operation: d.operation, quantity: q.quantity, diameter: a.feet };
  const b = checkDim(d.b);
  if (!("feet" in b)) return null;
  return d.shape === "rectangle"
    ? { shape: "rectangle", operation: d.operation, quantity: q.quantity, length: a.feet, width: b.feet }
    : { shape: "triangle", operation: d.operation, quantity: q.quantity, base: a.feet, height: b.feet };
}

function isBlank(d: AreaDraft) {
  return !d.a.ft.trim() && !d.a.in.trim() && !d.b.ft.trim() && !d.b.in.trim();
}

export function SquareFootageCalculator() {
  const t = useTranslations("calculators.squareFootage");
  const tc = useTranslations("calculators");
  const locale = useLocale();
  const [areas, setAreas] = usePersistedState<AreaDraft[]>(STORAGE_KEY, initialAreas(), isDrafts);

  const update = (id: string, patch: Partial<AreaDraft>) =>
    setAreas((list) => list.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => setAreas((list) => (list.length > 1 ? list.filter((d) => d.id !== id) : initialAreas()));

  const inputs = areas.map(toInput);
  const counted = inputs.filter((x): x is AreaInput => x !== null);
  const result = calculateArea(counted);
  const notCounted = areas.filter((d, i) => inputs[i] === null && !isBlank(d)).length;
  const fmt = (n: number, digits = 2) => formatNumber(locale, n, digits);
  const dimLabels = (shape: AreaShape) =>
    shape === "rectangle"
      ? [t("length"), t("width")]
      : shape === "triangle"
        ? [t("base"), t("height")]
        : [t("diameter")];

  // Default names: "Area 1, Area 2…" and "Deduction 1…", numbered separately.
  const counts = { add: 0, subtract: 0 };
  const defaultNames = areas.map((d) => {
    const n = ++counts[d.operation];
    return d.operation === "subtract" ? t("deductionN", { n }) : t("areaN", { n });
  });
  const names = areas.map((d, i) => d.name.trim() || defaultNames[i]);

  return (
    <div className="space-y-4">
      <p className="text-base text-neutral-700">{t("intro")}</p>

      <ol className="space-y-3">
        {areas.map((d, index) => {
          const isSub = d.operation === "subtract";
          const fallbackName = defaultNames[index];
          const input = inputs[index];
          const qty = checkQuantity(d.quantity);
          const labels = dimLabels(d.shape);
          return (
            <li
              key={d.id}
              className={`space-y-3 rounded-2xl border-2 bg-white p-4 shadow-sm ${isSub ? "border-red-300" : "border-neutral-200"}`}
            >
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-white ${isSub ? "bg-red-700" : "bg-green-700"}`}
                >
                  {isSub ? <Minus className="size-5" /> : <Plus className="size-5" />}
                </span>
                <label className="sr-only" htmlFor={`${d.id}-name`}>
                  {t("name")}
                </label>
                <input
                  id={`${d.id}-name`}
                  value={d.name}
                  onChange={(e) => update(d.id, { name: e.target.value })}
                  placeholder={fallbackName}
                  maxLength={60}
                  className="min-h-11 min-w-0 flex-1 rounded-lg border-2 border-transparent px-2 text-lg font-bold text-neutral-950 placeholder:text-neutral-950 hover:border-neutral-200 focus:border-brand-600 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  aria-label={t("removeArea", { name: names[index] })}
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg text-neutral-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 aria-hidden className="size-5" />
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <Segmented
                  label={t("addOrSubtract")}
                  value={d.operation}
                  onChange={(operation) => update(d.id, { operation })}
                  options={[
                    { value: "add", label: t("add") },
                    { value: "subtract", label: t("subtract") },
                  ]}
                  size="sm"
                />
                <Segmented
                  label={t("shape")}
                  value={d.shape}
                  onChange={(shape) => update(d.id, { shape })}
                  options={SHAPES.map((s) => ({ value: s, label: t(`shapes.${s}`) }))}
                  size="sm"
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                {labels.map((label, i) => {
                  const key = i === 0 ? "a" : "b";
                  return (
                    <DimensionInput
                      key={key}
                      id={`${d.id}-${key}`}
                      label={label}
                      value={d[key]}
                      onChange={(v) => update(d.id, { [key]: v })}
                    />
                  );
                })}
                {d.shape === "circle" && <div className="hidden sm:block" />}
                <div className="space-y-1">
                  <label htmlFor={`${d.id}-qty`} className="block text-sm font-semibold text-neutral-800">
                    {t("quantity")}
                  </label>
                  <input
                    id={`${d.id}-qty`}
                    value={d.quantity}
                    onChange={(e) => update(d.id, { quantity: e.target.value })}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={"error" in qty}
                    aria-describedby={"error" in qty ? `${d.id}-qty-error` : undefined}
                    className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-lg text-neutral-950 focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-red-600 sm:w-24"
                  />
                  {"error" in qty && (
                    <p id={`${d.id}-qty-error`} role="alert" className="text-sm font-medium text-red-700">
                      {t("errors.quantity")}
                    </p>
                  )}
                </div>
              </div>

              <p className="text-right text-base font-semibold text-neutral-800" aria-live="polite">
                {input ? (
                  <>
                    {isSub ? "− " : "+ "}
                    {fmt(result.lines[counted.indexOf(input)].total)} {tc("sqftUnit")}
                  </>
                ) : (
                  <span className="font-normal text-neutral-500">{t("enterDimensions")}</span>
                )}
              </p>
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-2 gap-3">
        <button type="button" onClick={() => setAreas((l) => [...l, newArea("add")])} className={buttonClasses("secondary", "lg")}>
          <Plus aria-hidden className="size-5 text-green-700" />
          {t("addArea")}
        </button>
        <button type="button" onClick={() => setAreas((l) => [...l, newArea("subtract")])} className={buttonClasses("secondary", "lg")}>
          <Minus aria-hidden className="size-5 text-red-700" />
          {t("addDeduction")}
        </button>
      </div>

      <section
        aria-labelledby="sqft-result"
        aria-live="polite"
        className="space-y-2 rounded-2xl border-2 border-brand-700 bg-brand-800 p-4 text-white shadow-lg"
      >
        <h2 id="sqft-result" className="text-sm font-semibold uppercase tracking-wide text-brand-100">
          {t("netArea")}
        </h2>
        <p className="text-4xl font-bold tabular-nums">
          {fmt(result.net)} <span className="text-2xl">{tc("sqftUnit")}</span>
        </p>
        <p className="text-sm text-brand-100 tabular-nums">
          {fmt(result.net / SQFT_PER_SQYD)} {tc("sqydUnit")} · {fmt(result.net / SQFT_PER_SQM)} {tc("sqmUnit")}
        </p>
        {result.subtracted > 0 && (
          <p className="text-sm text-brand-100 tabular-nums">
            {t("addedMinusSubtracted", { added: fmt(result.added), subtracted: fmt(result.subtracted) })}
          </p>
        )}
        {result.net < 0 && (
          <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-base font-semibold text-red-900">
            {t("errors.negative")}
          </p>
        )}
        {notCounted > 0 && (
          <p className="rounded-lg bg-amber-100 px-3 py-2 text-base font-semibold text-amber-950">
            {t("notCounted", { count: notCounted })}
          </p>
        )}
      </section>

      <ShowTheMath label={tc("showTheMath")}>
        {counted.length === 0 ? (
          <p>{t("enterDimensions")}</p>
        ) : (
          <>
            {areas.map((d, i) => {
              const input = inputs[i];
              if (!input) return null;
              const line = result.lines[counted.indexOf(input)];
              const name = names[i];
              const dims =
                input.shape === "rectangle"
                  ? `${formatFeetInches(input.length)} × ${formatFeetInches(input.width)}`
                  : input.shape === "triangle"
                    ? `½ × ${formatFeetInches(input.base)} × ${formatFeetInches(input.height)}`
                    : `π × (${formatFeetInches(input.diameter)})² ÷ 4`;
              return (
                <p key={d.id}>
                  <span className="font-sans font-semibold">{name}:</span> {dims} = {fmt(line.each)}
                  {input.quantity > 1 && ` × ${input.quantity} = ${fmt(line.total)}`} {tc("sqftUnit")}{" "}
                  <span className={line.signed < 0 ? "text-red-700" : "text-green-800"}>
                    ({line.signed < 0 ? "−" : "+"})
                  </span>
                </p>
              );
            })}
            <p className="border-t border-neutral-200 pt-2 font-semibold">
              {fmt(result.added)} − {fmt(result.subtracted)} = {fmt(result.net)} {tc("sqftUnit")}
            </p>
            <p className="font-sans text-neutral-600">{t("mathNote")}</p>
          </>
        )}
      </ShowTheMath>

      <button type="button" onClick={() => setAreas(initialAreas())} className={buttonClasses("ghost", "md")}>
        <RotateCcw aria-hidden className="size-5" />
        {tc("startOver")}
      </button>
    </div>
  );
}

function DimensionInput({ id, label, value, onChange }: { id: string; label: string; value: Dim; onChange: (v: Dim) => void }) {
  const t = useTranslations("calculators.squareFootage");
  const check = checkDim(value);
  const error = "error" in check ? check.error : null;
  const box =
    "block min-h-12 w-full min-w-0 rounded-xl border-2 border-neutral-300 bg-white px-3 pr-9 text-lg text-neutral-950 focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-red-600";
  return (
    <fieldset className="space-y-1" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="mb-1 text-sm font-semibold text-neutral-800">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <input
            id={`${id}-ft`}
            aria-label={`${label}, ${t("feet")}`}
            value={value.ft}
            onChange={(e) => onChange({ ...value, ft: e.target.value })}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            className={box}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-base text-neutral-600">
            ft
          </span>
        </div>
        <div className="relative">
          <input
            id={`${id}-in`}
            aria-label={`${label}, ${t("inches")}`}
            value={value.in}
            onChange={(e) => onChange({ ...value, in: e.target.value })}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            className={box}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-base text-neutral-600">
            in
          </span>
        </div>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-red-700">
          {t(`errors.${error}`)}
        </p>
      )}
    </fieldset>
  );
}
