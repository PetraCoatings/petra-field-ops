"use client";
import { useTranslations } from "next-intl";
import type { FormState } from "@/lib/forms/form-state";
import { Alert } from "./alert";

/**
 * Translate a key that arrives at runtime from a server action.
 * (Compile-time key checking can't apply to runtime strings.)
 */
export function useRuntimeT() {
  const t = useTranslations();
  return (key: string | undefined, values?: Record<string, string>) =>
    key ? (t as unknown as (k: string, v?: Record<string, string>) => string)(key, values) : undefined;
}

/** Banner for a form's overall success or error message. */
export function FormMessage({ state }: { state: FormState }) {
  const rt = useRuntimeT();
  if (!state.message) return null;
  return <Alert tone={state.status === "success" ? "success" : "error"}>{rt(state.message, state.messageValues)}</Alert>;
}
