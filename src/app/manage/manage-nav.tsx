"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import type { ManageNavKey } from "@/lib/auth/roles";

export function ManageNav({ items }: { items: { key: ManageNavKey; href: string; exact: boolean }[] }) {
  const pathname = usePathname();
  const t = useTranslations("manage.nav");
  return (
    <nav aria-label={t("dashboard")}>
      <ul className="flex gap-1 overflow-x-auto md:flex-col">
        {items.map((item) => {
          const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`block whitespace-nowrap rounded-lg px-3 py-2.5 text-base font-semibold ${
                  active ? "bg-brand-700 text-white" : "text-neutral-800 hover:bg-neutral-200"
                }`}
              >
                {t(item.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
