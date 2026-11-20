import { getLocale, getTranslations } from "next-intl/server";
import { setLocale } from "@/lib/actions/locale";

/** Two big buttons: English / Español. Works without JavaScript. */
export async function LanguageSwitcher() {
  const locale = await getLocale();
  const t = await getTranslations("common");
  const options = [
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
  ];
  return (
    <form action={setLocale} aria-label={t("language")} className="flex gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="submit"
          name="locale"
          value={o.value}
          aria-pressed={locale === o.value}
          lang={o.value}
          className={`min-h-11 rounded-xl border-2 px-4 text-base font-semibold ${
            locale === o.value
              ? "border-brand-700 bg-brand-700 text-white"
              : "border-neutral-300 bg-white text-neutral-900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </form>
  );
}
