import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/sign-out-button";
import { requireRole } from "@/lib/auth/dal";
import { manageNavFor } from "@/lib/auth/roles";
import { ManageNav } from "./manage-nav";

/**
 * Management dashboard shell (desktop-first, still usable on phones).
 * Project managers and office admins only; each page re-checks its own role.
 */
export default async function ManageLayout({ children }: LayoutProps<"/manage">) {
  const profile = await requireRole("project_manager", "office_admin");
  const t = await getTranslations();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="bg-brand-800 text-white">
        <div className="mx-auto flex min-h-14 max-w-7xl flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-white/10 font-black text-accent-400">
              P
            </span>
            <span className="text-lg font-bold">
              {t("common.shortName")} · {t("common.management")}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>
              {profile.displayName} ({t(`roles.${profile.role}`)})
            </span>
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-4 py-4 md:flex-row md:gap-8 md:py-8">
        <aside className="space-y-4 md:w-56 md:shrink-0">
          <ManageNav items={manageNavFor(profile.role)} />
          <div className="hidden space-y-3 border-t border-neutral-300 pt-4 md:block">
            <Link href="/" className="flex items-center gap-1 font-semibold text-brand-700">
              <ChevronLeft aria-hidden className="size-5" />
              {t("manage.backToField")}
            </Link>
            <SignOutButton />
          </div>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
