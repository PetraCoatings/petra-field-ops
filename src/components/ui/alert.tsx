import type { ReactNode } from "react";

const tones = {
  info: "border-brand-600 bg-brand-50 text-brand-900",
  success: "border-green-700 bg-green-50 text-green-900",
  warning: "border-accent-600 bg-amber-50 text-amber-950",
  error: "border-red-700 bg-red-50 text-red-900",
} as const;

export function Alert({ tone = "info", children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border-l-4 px-4 py-3 text-base font-medium ${tones[tone]}`}
    >
      {children}
    </div>
  );
}
