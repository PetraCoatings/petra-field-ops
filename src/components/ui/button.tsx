"use client";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";

import { type Size, type Variant, buttonClasses } from "./button-styles";

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}

/** Submit button that disables itself and shows a pending label while the form is sending. */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "lg",
  className = "",
}: {
  children: ReactNode;
  pendingLabel: ReactNode;
  variant?: Variant;
  size?: Size;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClasses(variant, size, className)}>
      {pending ? pendingLabel : children}
    </button>
  );
}
