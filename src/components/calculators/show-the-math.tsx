import type { ReactNode } from "react";

/** The "Show the math" expander under each calculator result. */
export function ShowTheMath({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-base font-semibold text-brand-700 [&::-webkit-details-marker]:hidden">
        {label}
        <span aria-hidden className="text-xl transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="space-y-2 border-t border-neutral-200 px-4 py-3 font-mono text-sm leading-relaxed text-neutral-800">
        {children}
      </div>
    </details>
  );
}
