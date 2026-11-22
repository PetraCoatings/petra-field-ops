import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { mixRatioLabel } from "@/domain/library/product";
import { requireRole } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { LibraryTabs } from "./library-tabs";
import { NewProductForm } from "./new-product-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("title") };
}

type Row = {
  id: string;
  name: string;
  category: string | null;
  spec_status: "draft" | "approved";
  is_active: boolean;
  mix_ratio_a: string | null;
  mix_ratio_b: string | null;
  mix_ratio_text: string | null;
  manufacturers: { name: string } | null;
  documents: { doc_type: "tds" | "sds"; document_versions: { id: string }[] }[];
};

export default async function LibraryPage({ searchParams }: PageProps<"/manage/library">) {
  await requireRole("project_manager", "office_admin");
  const { q: rawQ } = await searchParams;
  const q = typeof rawQ === "string" ? rawQ.trim() : "";
  const supabase = await createClient();
  const [{ data }, { data: mfrs }] = await Promise.all([
    supabase
      .from("products")
      .select("id, name, category, spec_status, is_active, mix_ratio_a, mix_ratio_b, mix_ratio_text, manufacturers(name), documents(doc_type, document_versions(id))")
      .order("name"),
    supabase.from("manufacturers").select("name").order("name"),
  ]);
  const t = await getTranslations("library");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = ((data ?? []) as unknown as Row[]).filter((r) => {
    const hay = `${r.name} ${r.manufacturers?.name ?? ""} ${r.category ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const has = (r: Row, type: "tds" | "sds") => r.documents.some((d) => d.doc_type === type && d.document_versions.length > 0);

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} />
      <LibraryTabs active="products" />
      <Card>
        <NewProductForm manufacturers={(mfrs ?? []).map((m) => m.name as string)} />
      </Card>
      <form role="search" action="/manage/library" className="flex max-w-xl gap-2">
        <label htmlFor="lib-q" className="sr-only">
          {t("search")}
        </label>
        <input id="lib-q" name="q" type="search" defaultValue={q} placeholder={t("searchPlaceholder")} className="block min-h-11 min-w-0 flex-1 rounded-xl border-2 border-neutral-300 bg-white px-3 text-base focus:border-brand-600 focus:outline-none" />
        <button type="submit" aria-label={t("search")} className="flex min-h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-white">
          <Search aria-hidden className="size-5" />
        </button>
      </form>
      <Card title={t("productsCount", { count: rows.length })}>
        {rows.length === 0 ? (
          <p className="text-neutral-700">{q ? t("noMatches") : t("empty")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/manage/library/products/${r.id}`} className={`flex items-center gap-3 py-3 hover:bg-brand-50 ${r.is_active ? "" : "opacity-60"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {r.name}
                      {r.manufacturers?.name && <span className="font-normal text-neutral-600"> · {r.manufacturers.name}</span>}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                      <span className={`rounded-full px-2.5 py-0.5 font-semibold ${r.spec_status === "approved" ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-950"}`}>
                        {t(`status.${r.spec_status}`)}
                      </span>
                      {!r.is_active && <span className="rounded-full bg-neutral-200 px-2.5 py-0.5 font-semibold">{t("archived")}</span>}
                      {r.category && <span className="text-neutral-700">{t(`categories.${r.category}` as "categories.other")}</span>}
                      {mixRatioLabel(r) && <span className="font-mono text-neutral-700">{mixRatioLabel(r)}</span>}
                      <span className={has(r, "tds") ? "text-green-800" : "text-neutral-500"}>{has(r, "tds") ? "✓ TDS" : t("noTds")}</span>
                      <span className={has(r, "sds") ? "text-green-800" : "text-neutral-500"}>{has(r, "sds") ? "✓ SDS" : t("noSds")}</span>
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-neutral-500" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
