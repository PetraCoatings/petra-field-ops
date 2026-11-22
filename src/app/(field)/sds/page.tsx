import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireProfile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { SdsList, type SdsItem } from "./sds-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home.modules");
  return { title: t("safetyData") };
}

type Row = {
  id: string;
  name: string | null;
  products: { name: string; manufacturers: { name: string } | null } | null;
  manufacturers: { name: string } | null;
  document_versions: { id: string; version: number; revision_date: string | null }[];
};

/** Every safety data sheet, for every employee, whether or not they're on a job. */
export default async function SdsPage() {
  await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, name, products(name, manufacturers(name)), manufacturers(name), document_versions(id, version, revision_date)")
    .eq("doc_type", "sds");
  const t = await getTranslations();
  const items: SdsItem[] = ((data ?? []) as unknown as Row[])
    .map((r) => {
      const current = [...r.document_versions].sort((a, b) => b.version - a.version)[0];
      return current
        ? {
            versionId: current.id,
            title: r.products?.name ?? r.name ?? "",
            manufacturer: r.products?.manufacturers?.name ?? r.manufacturers?.name ?? null,
            revisionDate: current.revision_date,
          }
        : null;
    })
    .filter((x): x is SdsItem => x !== null)
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <>
      <PageHeader title={t("home.modules.safetyData")} backHref="/" backLabel={t("common.home")} />
      <SdsList items={items} />
    </>
  );
}
