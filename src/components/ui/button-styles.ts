/** Button class names. Plain module so both server and client components can use it. */
export type Variant = "primary" | "secondary" | "danger" | "ghost";
export type Size = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const variants: Record<Variant, string> = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 active:bg-brand-900",
  secondary: "border-2 border-neutral-300 bg-white text-neutral-900 hover:bg-neutral-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
  ghost: "text-brand-700 hover:bg-brand-50",
};
const sizes: Record<Size, string> = {
  md: "min-h-11 px-4 text-base",
  lg: "min-h-14 px-6 text-lg",
};

export function buttonClasses(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

