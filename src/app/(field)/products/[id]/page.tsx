import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, ShieldAlert } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ProductSpecs } from "@/components/library/product-specs";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { currentDoc, fieldProduct } from "@/lib/library/field-products";
import { viewUrl } from "@/lib/library/view-url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: PageProps<"/products/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = UUID_RE.test(id) ? await fieldProduct(id) : null;
  return { title: p?.name };
}

export default async function FieldProductPage({ params }: PageProps<"/products/[id]">) {
  await requireProfile();
  const { id } = await params;
  const p = UUID_RE.test(id) ? await fieldProduct(id) : null;
  if (!p) notFound();
  const t = await getTranslations();
  const tds = currentDoc(p, "tds");
  const sds = currentDoc(p, "sds");
  const back = `/products/${p.id}`;
  return (
    <div className="space-y-4">
      <PageHeader title={p.name} backHref="/products" backLabel={t("home.modules.productData")} />
      <p className="text-base text-neutral-700">
        {[p.manufacturers?.name, p.category ? t(`library.categories.${p.category}` as "library.categories.other") : null, p.product_code].filter(Boolean).join(" · ")}
      </p>
      {(tds || sds) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {tds && (
            <Link href={viewUrl(tds, `${p.name} TDS`, back, "tds")} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-brand-600 bg-white p-3 font-semibold text-brand-700">
              <FileText aria-hidden className="size-7" />
              {t("library.docTypes.tds")}
            </Link>
          )}
          {sds && (
            <Link href={viewUrl(sds, `${p.name} SDS`, back, "sds")} className="flex min-h-14 items-center gap-3 rounded-2xl border-2 border-red-700 bg-white p-3 font-semibold text-red-800">
              <ShieldAlert aria-hidden className="size-7" />
              {t("library.docTypes.sds")}
            </Link>
          )}
        </div>
      )}
      {p.description && <p className="whitespace-pre-wrap rounded-2xl bg-white p-4 text-base">{p.description}</p>}
      <Card title={t("library.sections.specs")}>
        <ProductSpecs p={p} />
      </Card>
      {p.cure_notes && (
        <Card title={t("library.fields.cure_notes")}>
          <p className="whitespace-pre-wrap text-base">{p.cure_notes}</p>
        </Card>
      )}
    </div>
  );
}
