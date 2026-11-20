import { BrandMark } from "@/components/brand-mark";
import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button-styles";
import { requireProfile } from "@/lib/auth/dal";
import { canAccessManagement } from "@/lib/auth/roles";
import { isSupabaseConfigured } from "@/lib/supabase/env";

/** Field app shell: simple header, no menus. Every page below requires an active employee. */
export default async function FieldLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("common");
  if (!isSupabaseConfigured()) {
    return (
      <main className="mx-auto w-full max-w-xl p-4">
        <Alert tone="warning">{t("notConfigured")}</Alert>
      </main>
    );
  }
  const profile = await requireProfile();
  return (
    <>
      <header className="sticky top-0 z-10 bg-brand-800 pt-[env(safe-area-inset-top)] text-white shadow">
        <div className="mx-auto flex min-h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-bold">
            <BrandMark size={28} onDark />
            {t("shortName")}
          </Link>
          {canAccessManagement(profile.role) && (
            <Link href="/manage" className={buttonClasses("secondary", "md", "border-white/40 bg-white/10 text-white hover:bg-white/20")}>
              <LayoutDashboard aria-hidden className="size-5" />
              <span className="hidden sm:inline">{t("management")}</span>
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
    </>
  );
}
