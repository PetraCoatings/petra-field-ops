import { describe, expect, it } from "vitest";
import { checkProduct, isDocumentPath, mixRatioLabel, parseSpecNumber } from "./product";

describe("checkProduct", () => {
  it("accepts a product with only a name; every spec is 'not specified'", () => {
    const r = checkProduct({ name: "  Sikafloor 264 " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.name).toBe("Sikafloor 264");
    expect(r.values.volume_solids_pct).toBeNull();
    expect(r.values.mix_ratio_a).toBeNull();
    expect(r.values.description).toBeNull();
  });

  it("parses typed numbers", () => {
    const r = checkProduct({
      name: "Sikafloor 200C",
      category: "topcoat",
      mix_ratio_a: "2.18",
      mix_ratio_b: "1",
      ratio_basis: "volume",
      kit_size_gal: "3.31",
      recommended_coverage_sqft_per_gal: "1,000",
      volume_solids_pct: "100",
      min_application_temp_f: "50",
      max_application_temp_f: "86",
      pot_life_minutes: "25",
      min_substrate_above_dew_point_f: "5",
    });
    expect(r.ok && r.values).toMatchObject({ mix_ratio_a: 2.18, recommended_coverage_sqft_per_gal: 1000, pot_life_minutes: 25, category: "topcoat" });
  });

  it.each([
    [{ name: "" }, "name", "validation.required"],
    [{ name: "x", volume_solids_pct: "120" }, "volume_solids_pct", "library.errors.outOfRange"],
    [{ name: "x", volume_solids_pct: "0" }, "volume_solids_pct", "library.errors.outOfRange"],
    [{ name: "x", pot_life_minutes: "12.5" }, "pot_life_minutes", "library.errors.outOfRange"],
    [{ name: "x", kit_size_gal: "abc" }, "kit_size_gal", "library.errors.outOfRange"],
    [{ name: "x", mix_ratio_a: "2" }, "mix_ratio_b", "library.errors.bothParts"],
    [{ name: "x", min_application_temp_f: "90", max_application_temp_f: "50" }, "max_application_temp_f", "library.errors.minAboveMax"],
    [{ name: "x", category: "paint" }, "category", "validation.required"],
    [{ name: "x", description: "y".repeat(2001) }, "description", "validation.tooLong"],
  ])("refuses %j (%s)", (input, field, key) => {
    const r = checkProduct(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[field]).toBe(key);
  });

  it("allows temperatures below freezing", () => {
    expect(checkProduct({ name: "x", min_application_temp_f: "-10" }).ok).toBe(true);
  });
});

describe("helpers", () => {
  it("parseSpecNumber", () => {
    expect(parseSpecNumber("")).toBeNull();
    expect(parseSpecNumber(" 1,200.5 ")).toBe(1200.5);
    expect(parseSpecNumber("1.2.3")).toBeNaN();
  });
  it("mixRatioLabel", () => {
    expect(mixRatioLabel({ mix_ratio_a: "2.0000", mix_ratio_b: "1.0000" })).toBe("2A : 1B");
    expect(mixRatioLabel({ mix_ratio_a: 2.18, mix_ratio_b: 1, mix_ratio_text: "2.18A : 1B : .15C : .3Pig" })).toBe("2.18A : 1B : .15C : .3Pig");
    expect(mixRatioLabel({ mix_ratio_a: null, mix_ratio_b: null })).toBeNull();
  });
  it("isDocumentPath", () => {
    expect(isDocumentPath("d1/abc-file.pdf", "d1")).toBe(true);
    expect(isDocumentPath("d2/abc.pdf", "d1")).toBe(false);
    expect(isDocumentPath("d1/../d2/x.pdf", "d1")).toBe(false);
  });
});
