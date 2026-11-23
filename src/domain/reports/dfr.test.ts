import { describe, expect, it } from "vitest";
import { computeReport, readingWarnings, spreadFlags, type ComputeContext } from "./dfr";

const P1 = "11111111-1111-4111-8111-111111111111"; // has an 8 °F margin and 160 SF/gal coverage
const P2 = "22222222-2222-4222-8222-222222222222"; // no data sheet values
const ctx: ComputeContext = {
  companyMarginF: 5,
  products: new Map([
    [P1, { dewPointMarginF: 8, coverage: 160 }],
    [P2, { dewPointMarginF: null, coverage: null }],
  ]),
};

describe("daily report math", () => {
  it("dew point uses the product's margin when its data sheet has one", () => {
    // 70 °F air, 50% RH → dew point 50.5 °F. Surface 57 °F is 6.5° above.
    const r = computeReport(
      {
        readings: [
          { unit: "F", airTemp: 70, relativeHumidity: 50, substrateTemp: 57, productId: P1 },
          { unit: "F", airTemp: 70, relativeHumidity: 50, substrateTemp: 57, productId: P2 },
          { unit: "F", airTemp: 70, relativeHumidity: 50, substrateTemp: 57 },
        ],
      },
      ctx,
    );
    if (!r.ok) throw new Error(r.path);
    expect(r.content.readings.map((x) => [x.result?.marginSource, x.result?.marginF, x.result?.status])).toEqual([
      ["product", 8, "belowMargin"], // needs 8°: don't coat
      ["company", 5, "ok"], // no data-sheet margin: company 5°
      ["company", 5, "ok"],
    ]);
    expect(r.content.readings[0].result).toMatchObject({ dewPoint: 50.5, spread: 6.5, formulaVersion: "magnus-alduchov-eskridge-1996" });
    expect(readingWarnings(r.content)).toHaveLength(1);
  });

  it("actual spread rate = area × coats ÷ gallons, compared with the data sheet", () => {
    const r = computeReport(
      {
        materials: [
          { productId: P1, product: "Sikafloor 264", gallons: 45, areaSqft: 6620, coats: 1 }, // 147.1 SF/gal, −8.1%
          { productId: P1, product: "Sikafloor 264", gallons: 30, areaSqft: 3000, coats: 2 }, // 200 SF/gal, +25%
          { productId: P2, product: "Primer", gallons: 10, areaSqft: 2000 }, // no target
        ],
      },
      ctx,
    );
    if (!r.ok) throw new Error(r.path);
    expect(r.content.materials.map((m) => m.result)).toEqual([
      { actualSpreadRate: 147.1, targetSpreadRate: 160, variancePct: -8.1 },
      { actualSpreadRate: 200, targetSpreadRate: 160, variancePct: 25 },
      { actualSpreadRate: 200 },
    ]);
    expect(spreadFlags(r.content).map((m) => m.gallons)).toEqual([30]);
  });

  it("refuses bad input", () => {
    expect(computeReport({ readings: [{ unit: "F", airTemp: 70, relativeHumidity: 150 }] }, ctx)).toEqual({ ok: false, path: "readings.0.relativeHumidity" });
    expect(computeReport({ materials: [{ product: "X", gallons: 0, areaSqft: 10 }] }, ctx)).toMatchObject({ ok: false, path: "materials.0.gallons" });
  });
});
