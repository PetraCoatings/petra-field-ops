import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { DocumentUploader } from "@/components/library/document-uploader";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import { parseDateOnly } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { LibraryTabs } from "../library-tabs";
import { SdsRowActions } from "./sds-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("tabs.sds") };
}

type Row = {
  id: string;
  name: string | null;
  is_active: boolean;
  product_id: string | null;
  products: { name: string; manufacturers: { name: string } | null } | null;
  document_versions: { id: string; version: number; file_name: string; revision_date: string | null; uploaded_at: string }[];
};

/** Every SDS: product SDS and standalone ones (solvents, cleaners…). */
export default async function SdsAdminPage() {
  await requireRole("project_manager", "office_admin");
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, name, is_active, product_id, products(name, manufacturers(name)), document_versions(id, version, file_name, revision_date, uploaded_at)")
    .eq("doc_type", "sds");
  const t = await getTranslations("library");
  const format = await getFormatter();
  const rows = ((data ?? []) as unknown as Row[])
    .map((r) => ({ ...r, label: r.products?.name ?? r.name ?? "", current: [...r.document_versions].sort((a, b) => b.version - a.version)[0] }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="space-y-4">
      <PageHeader title={t("title")} />
      <LibraryTabs active="sds" />
      <Card title={t("sdsUploadTitle")}>
        <p className="mb-3 text-base text-neutral-700">{t("sdsUploadHint")}</p>
        <DocumentUploader target={{ kind: "standalone" }} label={t("upload.manySds")} />
      </Card>
      <Card title={t("sdsCount", { count: rows.length })}>
        {rows.length === 0 ? (
          <p className="text-neutral-700">{t("sdsEmpty")}</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {rows.map((r) => (
              <li key={r.id} className={`space-y-2 py-3 ${r.is_active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {r.label}
                      {r.products?.manufacturers?.name && <span className="font-normal text-neutral-600"> · {r.products.manufacturers.name}</span>}
                      {!r.is_active && <span className="ml-2 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-semibold">{t("hidden")}</span>}
                    </p>
                    {r.current ? (
                      <a href={`/documents/${r.current.id}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700 underline">
                        <FileText aria-hidden className="size-4" />
                        {r.current.file_name}
                      </a>
                    ) : (
                      <p className="text-sm text-neutral-600">{t("noFile")}</p>
                    )}
                    {r.current && (
                      <p className="text-xs text-neutral-600">
                        {[
                          t("versionN", { n: r.current.version }),
                          r.current.revision_date ? t("revisedOn", { date: format.dateTime(parseDateOnly(r.current.revision_date), { dateStyle: "medium" }) }) : null,
                          t("uploadedOn", { when: format.dateTime(new Date(r.current.uploaded_at), { dateStyle: "medium" }) }),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  {r.product_id ? (
                    <Link href={`/manage/library/products/${r.product_id}`} className="text-sm font-semibold text-brand-700 underline">
                      {t("openProduct")}
                    </Link>
                  ) : (
                    <SdsRowActions id={r.id} name={r.name ?? ""} isActive={r.is_active} />
                  )}
                </div>
                {!r.product_id && <DocumentUploader target={{ kind: "document", documentId: r.id }} label={t("upload.newVersion")} />}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
