/**
 * Result returned by server actions to their forms.
 * Messages are translation keys (e.g. "validation.required"), so the
 * browser shows them in the user's language.
 */
export type FormState = {
  status: "idle" | "success" | "error";
  /** Translation key for a message shown above the form. */
  message?: string;
  /** Values for ICU placeholders in `message`. */
  messageValues?: Record<string, string>;
  /** Per-field translation keys. */
  fieldErrors?: Record<string, string>;
};

export const idle: FormState = { status: "idle" };

/** Read a trimmed string from FormData; empty -> null. */
export function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function bool(fd: FormData, key: string): boolean {
  return fd.get(key) === "on" || fd.get(key) === "true";
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function isEmail(v: string | null): boolean {
  return v !== null && EMAIL_RE.test(v);
}

/**
 * Parse a non-negative decimal written by a person ("1,180.5" OK).
 * Returns the normalized string (never a float) or "invalid".
 */
export function decimalString(v: string | null): string | null | "invalid" {
  if (v === null) return null;
  const cleaned = v.replace(/,/g, "");
  return /^\d+(\.\d+)?$/.test(cleaned) ? cleaned : "invalid";
}

export function positiveInt(v: string | null): number | null | "invalid" {
  if (v === null) return null;
  if (!/^\d+$/.test(v)) return "invalid";
  const n = Number(v);
  return n > 0 ? n : "invalid";
}
