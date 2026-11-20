import { describe, expect, it } from "vitest";
import { calculateMix, combineUnits, splitUnits } from "./mix-ratio";

describe("calculateMix: total known", () => {
  it("2:1 by volume, 3 gal batch (384 fl oz) → 256 + 128 fl oz (2 gal + 1 gal)", () => {
    expect(calculateMix({ ratioA: 2, ratioB: 1, known: "total", amount: 384 })).toEqual({ a: 256, b: 128, total: 384 });
  });

  it("1:1, 1 gal → 64 + 64 fl oz", () => {
    expect(calculateMix({ ratioA: 1, ratioB: 1, known: "total", amount: 128 })).toEqual({ a: 64, b: 64, total: 128 });
  });

  it("parts always add up to the total after rounding (2:1, 100 fl oz)", () => {
    // exact 66.666… + 33.333… → 66.7 + 33.3 = 100.0
    expect(calculateMix({ ratioA: 2, ratioB: 1, known: "total", amount: 100 })).toEqual({ a: 66.7, b: 33.3, total: 100 });
  });

  it("largest remainder goes to the right part (1:2, 100 fl oz → 33.3 + 66.7)", () => {
    expect(calculateMix({ ratioA: 1, ratioB: 2, known: "total", amount: 100 })).toEqual({ a: 33.3, b: 66.7, total: 100 });
  });

  it("decimal ratios, e.g. 4.3:1 by weight, 10 lb batch (160 oz)", () => {
    const r = calculateMix({ ratioA: 4.3, ratioB: 1, known: "total", amount: 160 });
    expect(r).toEqual({ a: 129.8, b: 30.2, total: 160 }); // 129.811… + 30.188…
    expect(r.a + r.b).toBeCloseTo(r.total, 10);
  });

  it("a total that isn't a whole tenth is rounded first", () => {
    expect(calculateMix({ ratioA: 1, ratioB: 1, known: "total", amount: 10.04 }).total).toBe(10);
  });

  it("over many batch sizes, rounded parts always sum to the rounded total", () => {
    for (let t = 1; t <= 640; t += 0.7) {
      const r = calculateMix({ ratioA: 3, ratioB: 7, known: "total", amount: t });
      expect(Math.round((r.a + r.b) * 10)).toBe(Math.round(r.total * 10));
    }
  });
});

describe("calculateMix: one part known", () => {
  it("I have a full 1 gal of Part A at 2:1 → 64 fl oz of B, 192 total", () => {
    expect(calculateMix({ ratioA: 2, ratioB: 1, known: "a", amount: 128 })).toEqual({ a: 128, b: 64, total: 192 });
  });

  it("I have 5 lb (80 oz) of Part B at 4:1 by weight → 320 oz of A", () => {
    expect(calculateMix({ ratioA: 4, ratioB: 1, known: "b", amount: 80 })).toEqual({ a: 320, b: 80, total: 400 });
  });

  it("rounds the other part to 0.1 and the total is their sum", () => {
    // 3:1, 10 fl oz of A → 3.333… of B → 3.3; total 13.3
    expect(calculateMix({ ratioA: 3, ratioB: 1, known: "a", amount: 10 })).toEqual({ a: 10, b: 3.3, total: 13.3 });
  });
});

describe("calculateMix: rejects bad input", () => {
  it.each([
    [{ ratioA: 0 }],
    [{ ratioB: -1 }],
    [{ amount: 0 }],
    [{ amount: Number.NaN }],
  ])("%j", (bad) => {
    expect(() => calculateMix({ ratioA: 2, ratioB: 1, known: "total", amount: 128, ...bad })).toThrow(RangeError);
  });
});

describe("unit helpers", () => {
  it("splitUnits: 160 fl oz = 1 gal 32 fl oz; 40 oz = 2 lb 8 oz", () => {
    expect(splitUnits(160, "volume")).toEqual({ large: 1, small: 32 });
    expect(splitUnits(40, "weight")).toEqual({ large: 2, small: 8 });
    expect(splitUnits(66.7, "volume")).toEqual({ large: 0, small: 66.7 });
    expect(splitUnits(128, "volume")).toEqual({ large: 1, small: 0 });
  });
  it("combineUnits: 1 gal + 32 fl oz = 160 fl oz; 2 lb + 8 oz = 40 oz", () => {
    expect(combineUnits(1, 32, "volume")).toBe(160);
    expect(combineUnits(2, 8, "weight")).toBe(40);
  });
});
