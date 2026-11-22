import Link from "next/link";
import { getTranslations } from "next-intl/server";

export async function LibraryTabs({ active }: { active: "products" | "sds" }) {
  const t = await getTranslations("library");
  const cls = (on: boolean) =>
    `flex-1 rounded-lg px-3 py-2.5 text-center text-base font-semibold ${on ? "bg-brand-700 text-white shadow" : "text-neutral-800 hover:bg-white"}`;
  return (
    <nav aria-label={t("title")} className="flex max-w-xl rounded-xl border-2 border-neutral-300 bg-neutral-100 p-1">
      <Link href="/manage/library" aria-current={active === "products" ? "page" : undefined} className={cls(active === "products")}>
        {t("tabs.products")}
      </Link>
      <Link href="/manage/library/sds" aria-current={active === "sds" ? "page" : undefined} className={cls(active === "sds")}>
        {t("tabs.sds")}
      </Link>
    </nav>
  );
}
