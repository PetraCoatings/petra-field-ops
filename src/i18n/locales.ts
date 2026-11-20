export const LOCALES = ["en", "es"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
/** Cookie that remembers the chosen language on this device. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export function toLocale(value: string | undefined | null): Locale {
  return (LOCALES as readonly string[]).includes(value ?? "") ? (value as Locale) : DEFAULT_LOCALE;
}
