import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, FileText, Search, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ProductSpecs } from "@/components/library/product-specs";
import { PageHeader } from "@/components/ui/page-header";
import { PRODUCT_CATEGORIES } from "@/domain/library/product";
import { requireProfile } from "@/lib/auth/dal";
import { currentDoc, fieldProducts } from "@/lib/library/field-products";
import { viewUrl } from "@/lib/library/view-url";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("productData") };
}

/** Product data sheets: approved products with their key specs, TDS and SDS. */
export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  await requireProfile();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const mfr = typeof sp.mfr === "string" ? sp.mfr : "";
  const cat = typeof sp.cat === "string" ? sp.cat : "";
  const all = await fieldProducts();
  const t = await getTranslations();
  const manufacturers = [...new Set(all.map((p) => p.manufacturers?.name).filter((x): x is string => Boolean(x)))].sort();
  const categories = PRODUCT_CATEGORIES.filter((c) => all.some((p) => p.category === c));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const products = all.filter(
    (p) =>
      (!mfr || p.manufacturers?.name === mfr) &&
      (!cat || p.category === cat) &&
      words.every((w) => `${p.name} ${p.manufacturers?.name ?? ""} ${p.product_code ?? ""}`.toLowerCase().includes(w)),
  );
  const back = `/products${q || mfr || cat ? `?${new URLSearchParams({ ...(q && { q }), ...(mfr && { mfr }), ...(cat && { cat }) })}` : ""}`;
  const select = "block min-h-11 w-full rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none";

  return (
    <>
      <PageHeader title={t("home.modules.productData")} backHref="/" backLabel={t("common.home")} />
      <form role="search" action="/products" className="mb-4 space-y-2 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
        <div className="flex gap-2">
          <label htmlFor="prod-q" className="sr-only">
            {t("products.search")}
          </label>
          <input id="prod-q" name="q" type="search" defaultValue={q} placeholder={t("products.searchPlaceholder")} className="block min-h-12 min-w-0 flex-1 rounded-xl border-2 border-neutral-300 bg-white px-3 text-lg focus:border-brand-600 focus:outline-none" />
          <button type="submit" aria-label={t("products.search")} className="flex min-h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-700 text-white">
            <Search aria-hidden className="size-6" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="prod-mfr" className="sr-only">
              {t("library.fields.manufacturer")}
            </label>
            <select id="prod-mfr" name="mfr" defaultValue={mfr} className={select}>
              <option value="">{t("products.anyManufacturer")}</option>
              {manufacturers.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="prod-cat" className="sr-only">
              {t("library.fields.category")}
            </label>
            <select id="prod-cat" name="cat" defaultValue={cat} className={select}>
              <option value="">{t("products.anyCategory")}</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {t(`library.categories.${c}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </form>

      {products.length === 0 ? (
        <p className="rounded-2xl bg-white p-6 text-center text-lg text-neutral-700">{all.length === 0 ? t("products.empty") : t("products.noMatches")}</p>
      ) : (
        <ul className="space-y-3">
          {products.map((p) => {
            const tds = currentDoc(p, "tds");
            const sds = currentDoc(p, "sds");
            return (
              <li key={p.id} className="space-y-3 rounded-2xl border-2 border-neutral-200 bg-white p-4">
                <Link href={`/products/${p.id}`} className="flex items-start gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-lg font-bold leading-snug">{p.name}</span>
                    <span className="block text-sm text-neutral-700">
                      {[p.manufacturers?.name, p.category ? t(`library.categories.${p.category}` as "library.categories.other") : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-neutral-500" />
                </Link>
                <ProductSpecs p={p} compact />
                <div className="flex flex-wrap gap-2">
                  {tds && (
                    <Link href={viewUrl(tds, `${p.name} TDS`, back, "tds")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-brand-600 px-3 font-semibold text-brand-700">
                      <FileText aria-hidden className="size-5" />
                      TDS
                    </Link>
                  )}
                  {sds && (
                    <Link href={viewUrl(sds, `${p.name} SDS`, back, "sds")} className="inline-flex min-h-11 items-center gap-2 rounded-xl border-2 border-red-700 px-3 font-semibold text-red-800">
                      <ShieldAlert aria-hidden className="size-5" />
                      SDS
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
