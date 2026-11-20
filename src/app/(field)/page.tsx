import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ModuleIcon } from "@/components/module-icon";
import { SignOutButton } from "@/components/sign-out-button";
import { Alert } from "@/components/ui/alert";
import { requireProfile } from "@/lib/auth/dal";
import { FIELD_MODULES } from "@/lib/auth/roles";

/** Installer home: the six primary modules as large tiles. Time Clock is first. */
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const profile = await requireProfile();
  const t = await getTranslations();
  const { denied } = await searchParams;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("home.greeting", { name: profile.firstName })}</h1>
        <p className="text-base text-neutral-700">{t(`roles.${profile.role}`)}</p>
      </div>
      {denied && <Alert tone="warning">{t("home.accessDenied")}</Alert>}
      <nav aria-label={t("common.home")}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
          {FIELD_MODULES.map((m) => (
            <li key={m.key}>
              <Link
                href={m.href}
                className={`flex min-h-32 flex-col items-center justify-center gap-3 rounded-2xl border-2 p-4 text-center shadow-sm transition-colors sm:min-h-40 ${
                  m.key === "timeClock"
                    ? "border-accent-600 bg-accent-400 text-neutral-950 hover:bg-accent-500"
                    : "border-neutral-200 bg-white text-neutral-950 hover:border-brand-600 hover:bg-brand-50"
                }`}
              >
                <ModuleIcon module={m.key} className="size-10 sm:size-12" />
                <span className="text-lg font-bold leading-tight">{t(`home.modules.${m.key}`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-300 pt-5">
        <LanguageSwitcher />
        <SignOutButton />
      </div>
    </div>
  );
}
