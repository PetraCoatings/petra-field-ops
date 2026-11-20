"use client";

/** A row of large toggle buttons for choosing one option (unit, shape, add/subtract). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = "md",
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "md" | "sm";
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-xl border-2 border-neutral-300 bg-neutral-100 p-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.value)}
            className={`flex-1 rounded-lg px-3 font-semibold transition-colors ${size === "md" ? "min-h-11 text-base" : "min-h-10 text-sm"} ${
              selected ? "bg-brand-700 text-white shadow" : "text-neutral-800 hover:bg-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
