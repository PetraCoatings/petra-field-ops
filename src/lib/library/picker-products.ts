import "server-only";
import { createClient } from "@/lib/supabase/server";

import type { PickerProduct } from "./picker-types";

export type { PickerProduct };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function pickerProducts(): Promise<PickerProduct[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, name, mix_ratio_a, mix_ratio_b, mix_ratio_text, ratio_basis, kit_size_gal, recommended_coverage_sqft_per_gal, volume_solids_pct, recommended_wft_mils, recommended_dft_mils, min_substrate_above_dew_point_f, manufacturers(name), documents(doc_type, is_active, document_versions(id, version))",
    )
    .eq("spec_status", "approved")
    .eq("is_active", true)
    .order("name");
  type Row = Record<string, unknown> & {
    manufacturers: { name: string } | null;
    documents: { doc_type: "tds" | "sds"; is_active: boolean; document_versions: { id: string; version: number }[] }[];
  };
  const current = (r: Row, type: "tds" | "sds") => {
    const d = r.documents.find((x) => x.doc_type === type && x.is_active);
    return d ? ([...d.document_versions].sort((a, b) => b.version - a.version)[0]?.id ?? null) : null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id as string,
    name: r.name as string,
    manufacturer: r.manufacturers?.name ?? null,
    mixRatioA: num(r.mix_ratio_a),
    mixRatioB: num(r.mix_ratio_b),
    mixRatioText: (r.mix_ratio_text as string | null) ?? null,
    ratioBasis: (r.ratio_basis as "volume" | "weight" | null) ?? null,
    kitSizeGal: num(r.kit_size_gal),
    coverage: num(r.recommended_coverage_sqft_per_gal),
    volumeSolids: num(r.volume_solids_pct),
    wftMils: num(r.recommended_wft_mils),
    dftMils: num(r.recommended_dft_mils),
    dewPointMarginF: num(r.min_substrate_above_dew_point_f),
    tdsVersionId: current(r, "tds"),
    sdsVersionId: current(r, "sds"),
  }));
}
