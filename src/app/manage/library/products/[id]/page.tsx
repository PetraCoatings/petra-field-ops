import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { DocumentSlot, type VersionRow } from "@/components/library/document-slot";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/auth/dal";
import { directoryNames } from "@/lib/db/queries";
import { createClient } from "@/lib/supabase/server";
import { ProductEditor, type ProductForm } from "./product-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("library");
  return { title: t("editTitle") };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ProductPage({ params }: PageProps<"/manage/library/products/[id]">) {
  const profile = await requireRole("project_manager", "office_admin");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: p }, { data: mfrs }] = await Promise.all([
    supabase
      .from("products")
      .select("*, manufacturers(name), documents(id, doc_type, document_versions(id, version, file_name, file_size, revision_date, uploaded_by, uploaded_at))")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("manufacturers").select("name").order("name"),
  ]);
  if (!p) notFound();
  const t = await getTranslations("library");
  const format = await getFormatter();
  const docs = (p.documents ?? []) as { id: string; doc_type: "tds" | "sds"; document_versions: VersionRow[] }[];
  const versions = (type: "tds" | "sds") => docs.find((d) => d.doc_type === type)?.document_versions ?? [];
  const names = await directoryNames([p.approved_by as string | null]);
  const str = (v: unknown) => (v === null || v === undefined ? "" : String(Number(v)));
  const initial: ProductForm = {
    name: p.name as string,
    manufacturer: (p.manufacturers as { name: string } | null)?.name ?? "",
    category: (p.category as string | null) ?? "",
    product_code: (p.product_code as string | null) ?? "",
    description: (p.description as string | null) ?? "",
    mix_ratio_a: str(p.mix_ratio_a),
    mix_ratio_b: str(p.mix_ratio_b),
    mix_ratio_text: (p.mix_ratio_text as string | null) ?? "",
    ratio_basis: (p.ratio_basis as string | null) ?? "",
    kit_size_gal: str(p.kit_size_gal),
    recommended_coverage_sqft_per_gal: str(p.recommended_coverage_sqft_per_gal),
    volume_solids_pct: str(p.volume_solids_pct),
    recommended_wft_mils: str(p.recommended_wft_mils),
    recommended_dft_mils: str(p.recommended_dft_mils),
    min_application_temp_f: str(p.min_application_temp_f),
    max_application_temp_f: str(p.max_application_temp_f),
    max_rh_pct: str(p.max_rh_pct),
    min_substrate_above_dew_point_f: str(p.min_substrate_above_dew_point_f),
    pot_life_minutes: str(p.pot_life_minutes),
    cure_notes: (p.cure_notes as string | null) ?? "",
  };
  const approvedLine =
    p.spec_status === "approved" && p.approved_at
      ? t("approvedBy", {
          name: (p.approved_by && names.get(p.approved_by as string)?.display_name) || t("someone"),
          when: format.dateTime(new Date(p.approved_at as string), { dateStyle: "medium" }),
        })
      : null;

  return (
    <div className="space-y-4">
      <PageHeader title={p.name as string} backHref="/manage/library" backLabel={t("title")} />
      <ProductEditor
        id={id}
        initial={initial}
        status={p.spec_status as "draft" | "approved"}
        approvedLine={approvedLine}
        isActive={p.is_active as boolean}
        isAdmin={profile.role === "office_admin"}
        manufacturers={(mfrs ?? []).map((m) => m.name as string)}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <DocumentSlot productId={id} docType="tds" versions={versions("tds")} />
        <DocumentSlot productId={id} docType="sds" versions={versions("sds")} />
      </div>
    </div>
  );
}
