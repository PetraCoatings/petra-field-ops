import { describe, expect, it } from "vitest";
import { validateAndCompute } from "./saved";

const ctx = { dewPointMarginF: 5 };

describe("validateAndCompute", () => {
  it("square footage: recomputes the net area from the areas", () => {
    const r = validateAndCompute(
      "square_footage",
      {
        areas: [
          { shape: "rectangle", operation: "add", quantity: 1, length: 120, width: 80, name: "Floor" },
          { shape: "rectangle", operation: "subtract", quantity: 6, length: 2, width: 2 },
        ],
      },
      ctx,
    );
    expect(r?.outputs).toEqual({ added: 9600, subtracted: 24, net: 9576 });
  });

  it("square footage: refuses a negative net area", () => {
    const r = validateAndCompute(
      "square_footage",
      { areas: [{ shape: "rectangle", operation: "subtract", quantity: 1, length: 10, width: 10 }] },
      ctx,
    );
    expect(r).toBeNull();
  });

  it("ignores any result the phone sends: only inputs are read", () => {
    const r = validateAndCompute("mix_ratio", { basis: "volume", ratioA: 2, ratioB: 1, known: "total", amount: 384, a: 999 }, ctx);
    expect(r?.outputs).toEqual({ a: 256, b: 128, total: 384 });
    expect(r?.inputs).not.toHaveProperty("a"); // unknown keys are dropped
  });

  it("spread rate: both directions, owner decision Q15 examples", () => {
    const a = validateAndCompute("spread_rate", { mode: "fromRate", spreadRate: 200 }, ctx);
    expect((a?.outputs as { wft: number }).wft).toBeCloseTo(8.0208, 4);
    const b = validateAndCompute("spread_rate", { mode: "fromMils", mils: 10, basis: "wft" }, ctx);
    expect((b?.outputs as { spreadRate: number }).spreadRate).toBeCloseTo(160.4167, 4);
  });

  it("spread rate: a dry film target without volume solids is refused", () => {
    expect(validateAndCompute("spread_rate", { mode: "fromMils", mils: 6, basis: "dft" }, ctx)).toBeNull();
  });

  it("material quantity: from wet mils, with kits", () => {
    const r = validateAndCompute(
      "material_quantity",
      { areaSqft: 2000, coverage: { mode: "mils", wftMils: 10 }, coats: 2, wastePct: 10, kitGallons: 3 },
      ctx,
    );
    expect(r?.outputs).toMatchObject({ kits: 10 });
    expect((r?.outputs as { totalGallons: number }).totalGallons).toBeCloseTo(27.4286, 4);
  });

  it("dew point: uses the company margin from the server, not the phone", () => {
    const r = validateAndCompute("dew_point", { unit: "F", airTemp: 70, relativeHumidity: 50, substrateTemp: 60, marginF: 0 }, { dewPointMarginF: 10 });
    expect(r?.outputs).toMatchObject({ dewPoint: 50.5, marginF: 10, minimumSubstrate: 60.5, spread: 9.5, status: "belowMargin" });
    expect(r?.inputs).not.toHaveProperty("marginF");
  });

  it.each([
    ["unknown type", "payroll", {}],
    ["missing fields", "mix_ratio", { basis: "volume" }],
    ["zero ratio", "mix_ratio", { basis: "volume", ratioA: 0, ratioB: 1, known: "total", amount: 10 }],
    ["text instead of a number", "dew_point", { unit: "F", airTemp: "70", relativeHumidity: 50 }],
    ["humidity over 100", "dew_point", { unit: "F", airTemp: 70, relativeHumidity: 101 }],
    ["fractional coats", "material_quantity", { areaSqft: 100, coverage: { mode: "rate", spreadRate: 100 }, coats: 1.5, wastePct: 0 }],
    ["infinite area", "material_quantity", { areaSqft: Infinity, coverage: { mode: "rate", spreadRate: 100 }, coats: 1, wastePct: 0 }],
    ["no areas", "square_footage", { areas: [] }],
    ["absurd length", "square_footage", { areas: [{ shape: "circle", operation: "add", quantity: 1, diameter: 1e9 }] }],
    ["not an object", "square_footage", "areas"],
  ])("refuses %s", (_label, type, inputs) => {
    expect(validateAndCompute(type, inputs, ctx)).toBeNull();
  });
});
