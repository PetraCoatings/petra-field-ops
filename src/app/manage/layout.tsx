import { BrandMark } from "@/components/brand-mark";
import Link from "next/link";
import { House } from "lucide-react";
import { buttonClasses } from "@/components/ui/button-styles";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/sign-out-button";
import { requireRole } from "@/lib/auth/dal";
import { manageNavFor } from "@/lib/auth/roles";
import { ManageNav } from "./manage-nav";

/**
 * Management dashboard shell (desktop-first, still usable on phones).
 * The "Field app" button in the header leads back on every screen size.
 * Project managers and office admins only; each page re-checks its own role.
 */
export default async function ManageLayout({ children }: LayoutProps<"/manage">) {
  const profile = await requireRole("project_manager", "office_admin");
  const t = await getTranslations();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="sticky top-0 z-10 bg-brand-800 pt-[env(safe-area-inset-top)] text-white shadow">
        <div className="mx-auto flex min-h-14 max-w-7xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <BrandMark size={28} onDark />
            <span className="truncate text-lg font-bold">{t("common.management")}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden lg:inline">
              {profile.displayName} ({t(`roles.${profile.role}`)})
            </span>
            {/* Always visible: the installed phone app has no browser back button. */}
            <Link href="/" className={buttonClasses("secondary", "md", "border-white/40 bg-white/10 text-white hover:bg-white/20")}>
              <House aria-hidden className="size-5" />
              {t("common.fieldApp")}
            </Link>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 md:flex-row md:gap-8 md:py-8">
        <aside className="space-y-4 md:w-56 md:shrink-0">
          <ManageNav items={manageNavFor(profile.role)} />
          <div className="hidden border-t border-neutral-300 pt-4 md:block">
            <SignOutButton />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
