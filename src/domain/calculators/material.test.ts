import { describe, expect, it } from "vitest";
import { calculateMaterial, spreadRateForWftMils } from "./material";

const base = { areaSqft: 2000, spreadRate: 200, coats: 1, wastePct: 0 };

describe("calculateMaterial", () => {
  it("2,000 SF at 200 SF/gal, 1 coat, no waste = 10 gal", () => {
    expect(calculateMaterial(base)).toEqual({ baseGallons: 10, wasteGallons: 0, totalGallons: 10 });
  });

  it("waste is added on top: 10% of 10 gal = 11 gal", () => {
    const r = calculateMaterial({ ...base, wastePct: 10 });
    expect(r.baseGallons).toBe(10);
    expect(r.wasteGallons).toBeCloseTo(1, 12);
    expect(r.totalGallons).toBeCloseTo(11, 12);
  });

  it("two coats doubles the material", () => {
    expect(calculateMaterial({ ...base, coats: 2 }).totalGallons).toBe(20);
  });

  it("kits round up to a whole kit and report the leftover", () => {
    // 11 gal needed, 3-gal kits → 4 kits (12 gal), 1 gal left over
    const r = calculateMaterial({ ...base, wastePct: 10, kitGallons: 3 });
    expect(r.kits).toBe(4);
    expect(r.leftoverGallons).toBeCloseTo(1, 10);
  });

  it("an exact fit needs no extra kit, even with floating-point noise", () => {
    // 9,851.5 SF, 2 coats at 197.03 SF/gal = 100 gal → exactly 20 five-gallon kits
    const r = calculateMaterial({ areaSqft: 9851.5, spreadRate: 197.03, coats: 2, wastePct: 0, kitGallons: 5 });
    expect(r.totalGallons).toBeCloseTo(100, 10);
    expect(r.kits).toBe(20);
    expect(r.leftoverGallons).toBeCloseTo(0, 10);
  });

  it("a warehouse floor: 9,851.5 SF, 10 mils wet, 2 coats, 5% waste, 3-gal kits", () => {
    const rate = spreadRateForWftMils(10); // 160.4166… SF/gal
    const r = calculateMaterial({ areaSqft: 9851.5, spreadRate: rate, coats: 2, wastePct: 5, kitGallons: 3 });
    expect(r.baseGallons).toBeCloseTo(122.8239, 4); // 9851.5 × 2 ÷ 160.4167
    expect(r.totalGallons).toBeCloseTo(128.9651, 4);
    expect(r.kits).toBe(43); // 128.97 ÷ 3 = 42.99 → 43
  });

  it("without a kit size, kits aren't reported", () => {
    const r = calculateMaterial(base);
    expect(r.kits).toBeUndefined();
    expect(r.leftoverGallons).toBeUndefined();
  });

  it.each([
    [{ areaSqft: 0 }],
    [{ areaSqft: -5 }],
    [{ spreadRate: 0 }],
    [{ coats: 0 }],
    [{ coats: 1.5 }],
    [{ wastePct: -1 }],
    [{ wastePct: 100 }],
    [{ kitGallons: 0 }],
  ])("rejects %j", (bad) => {
    expect(() => calculateMaterial({ ...base, ...bad })).toThrow(RangeError);
  });
});
