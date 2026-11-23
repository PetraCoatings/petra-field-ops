import "server-only";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_DEW_POINT_MARGIN_F } from "@/domain/calculators/dew-point";
import type { ComputeContext } from "@/domain/reports/dfr";

/** Company margin and approved products' data-sheet values, read on the server. */
export async function reportContext(): Promise<ComputeContext> {
  const supabase = await createClient();
  const [{ data: settings }, { data: products }] = await Promise.all([
    supabase.from("app_settings").select("dew_point_margin_f").single(),
    supabase.from("products").select("id, min_substrate_above_dew_point_f, recommended_coverage_sqft_per_gal").eq("spec_status", "approved"),
  ]);
  const margin = Number(settings?.dew_point_margin_f);
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    companyMarginF: Number.isFinite(margin) && margin >= 0 ? margin : DEFAULT_DEW_POINT_MARGIN_F,
    products: new Map((products ?? []).map((p) => [p.id as string, { dewPointMarginF: num(p.min_substrate_above_dew_point_f), coverage: num(p.recommended_coverage_sqft_per_gal) }])),
  };
}
