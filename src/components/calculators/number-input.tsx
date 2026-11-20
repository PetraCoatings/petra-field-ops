"use client";

/** A large number box with a unit on the right, for the calculators. */
export function NumberInput({
  id,
  label,
  suffix,
  value,
  onChange,
  error,
  help,
  belowZeroLabel,
}: {
  id: string;
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  help?: string;
  /**
   * Shows a "−" toggle for values that can be below zero (temperatures):
   * phone number keypads often have no minus key. The text is its label.
   */
  belowZeroLabel?: string;
}) {
  const negative = value.trim().startsWith("-");
  const toggleSign = () => {
    const v = value.trim();
    onChange(negative ? v.slice(1) : `-${v}`);
  };
  const describedBy = error ? `${id}-error` : help ? `${id}-help` : undefined;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-semibold text-neutral-800">
        {label}
      </label>
      <div className="flex gap-2">
        {belowZeroLabel && (
          <button
            type="button"
            onClick={toggleSign}
            aria-pressed={negative}
            aria-label={belowZeroLabel}
            className={`min-h-12 w-12 shrink-0 rounded-xl border-2 text-xl font-bold ${negative ? "border-brand-700 bg-brand-700 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}
          >
            −
          </button>
        )}
        <div className="relative min-w-0 flex-1">
          <input
            id={id}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className="block min-h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 pr-20 text-lg text-neutral-950 focus:border-brand-600 focus:outline-none aria-[invalid=true]:border-red-600"
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-base text-neutral-600">
            {suffix}
          </span>
        </div>
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      ) : (
        help && (
          <p id={`${id}-help`} className="text-sm text-neutral-600">
            {help}
          </p>
        )
      )}
    </div>
  );
}
