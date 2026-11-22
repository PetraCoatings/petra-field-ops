import "server-only";
import { createClient } from "@/lib/supabase/server";

export type FieldProduct = {
  id: string;
  name: string;
  category: string | null;
  product_code: string | null;
  description: string | null;
  mix_ratio_a: string | null;
  mix_ratio_b: string | null;
  mix_ratio_text: string | null;
  ratio_basis: "volume" | "weight" | null;
  kit_size_gal: string | null;
  recommended_coverage_sqft_per_gal: string | null;
  volume_solids_pct: string | null;
  recommended_wft_mils: string | null;
  recommended_dft_mils: string | null;
  min_application_temp_f: string | null;
  max_application_temp_f: string | null;
  max_rh_pct: string | null;
  min_substrate_above_dew_point_f: string | null;
  pot_life_minutes: number | null;
  cure_notes: string | null;
  manufacturers: { name: string } | null;
  documents: { doc_type: "tds" | "sds"; is_active: boolean; document_versions: { id: string; version: number }[] }[];
};

const SELECT =
  "id, name, category, product_code, description, mix_ratio_a, mix_ratio_b, mix_ratio_text, ratio_basis, kit_size_gal, recommended_coverage_sqft_per_gal, volume_solids_pct, recommended_wft_mils, recommended_dft_mils, min_application_temp_f, max_application_temp_f, max_rh_pct, min_substrate_above_dew_point_f, pot_life_minutes, cure_notes, manufacturers(name), documents(doc_type, is_active, document_versions(id, version))";

/** Products the field can see: approved and active (Row Level Security; office staff also see only these here). */
export async function fieldProducts(): Promise<FieldProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select(SELECT).eq("spec_status", "approved").eq("is_active", true).order("name");
  return (data ?? []) as unknown as FieldProduct[];
}

export async function fieldProduct(id: string): Promise<FieldProduct | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("products").select(SELECT).eq("id", id).eq("spec_status", "approved").eq("is_active", true).maybeSingle();
  return (data as unknown as FieldProduct | null) ?? null;
}

/** The current version of a product's TDS or SDS. */
export function currentDoc(p: FieldProduct, type: "tds" | "sds"): string | null {
  const d = p.documents.find((x) => x.doc_type === type && x.is_active);
  const v = d ? [...d.document_versions].sort((a, b) => b.version - a.version)[0] : undefined;
  return v?.id ?? null;
}
