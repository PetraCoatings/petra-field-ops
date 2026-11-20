import { describe, expect, it } from "vitest";
import {
  dftFromWft,
  fromMils,
  fromSpreadRate,
  SQFT_MILS_PER_GALLON,
  spreadRateFromWft,
  wftFromDft,
  wftFromSpreadRate,
} from "./spread-rate";

const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

describe("coverage constant", () => {
  it("is 231 in³ ÷ 0.144 in³ = 1604.1666…, shown as 1604.17", () => {
    expect(SQFT_MILS_PER_GALLON).toBeCloseTo(1604.1666667, 6);
    expect(round(SQFT_MILS_PER_GALLON, 2)).toBe(1604.17);
  });
});

describe("owner decision Q15 examples", () => {
  it("200 ft²/gal → 8.02 mils wet", () => {
    expect(round(wftFromSpreadRate(200), 2)).toBe(8.02);
  });
  it("10 mils wet → 160.4 ft²/gal", () => {
    expect(round(spreadRateFromWft(10), 1)).toBe(160.4);
  });
});

describe("conversions", () => {
  it("spread rate and WFT are inverses", () => {
    expect(spreadRateFromWft(wftFromSpreadRate(137))).toBeCloseTo(137, 10);
  });
  it("DFT = WFT × volume solids", () => {
    expect(dftFromWft(10, 75)).toBe(7.5);
    expect(dftFromWft(16, 100)).toBe(16);
  });
  it("WFT = DFT ÷ volume solids", () => {
    expect(wftFromDft(6, 60)).toBe(10);
  });
});

describe("fromSpreadRate", () => {
  it("100% solids epoxy at 100 ft²/gal: 16.04 mils wet = dry", () => {
    const r = fromSpreadRate({ spreadRate: 100, volumeSolidsPct: 100 });
    expect(round(r.wft, 2)).toBe(16.04);
    expect(r.dft).toBe(r.wft);
  });
  it("urethane at 400 ft²/gal, 60% solids: 4.01 wet, 2.41 dry", () => {
    const r = fromSpreadRate({ spreadRate: 400, volumeSolidsPct: 60 });
    expect(round(r.wft, 2)).toBe(4.01);
    expect(round(r.dft!, 2)).toBe(2.41);
  });
  it("without volume solids, DFT is not reported (never guessed)", () => {
    expect(fromSpreadRate({ spreadRate: 200 })).toEqual({ wft: SQFT_MILS_PER_GALLON / 200 });
  });
  it.each([0, -50, Number.NaN, Number.POSITIVE_INFINITY])("rejects spread rate %d", (spreadRate) => {
    expect(() => fromSpreadRate({ spreadRate })).toThrow(RangeError);
  });
  it.each([0, 101, -5])("rejects volume solids %d", (volumeSolidsPct) => {
    expect(() => fromSpreadRate({ spreadRate: 200, volumeSolidsPct })).toThrow(RangeError);
  });
});

describe("fromMils", () => {
  it("10 mils wet → 160.4 ft²/gal; with 75% solids that is 7.5 dry", () => {
    const r = fromMils({ mils: 10, basis: "wft", volumeSolidsPct: 75 });
    expect(r.wft).toBe(10);
    expect(r.dft).toBe(7.5);
    expect(round(r.spreadRate, 1)).toBe(160.4);
    expect(r.practicalSpreadRate).toBeUndefined();
  });
  it("6 mils dry at 60% solids → 10 mils wet → 160.4 ft²/gal", () => {
    const r = fromMils({ mils: 6, basis: "dft", volumeSolidsPct: 60 });
    expect(r.wft).toBe(10);
    expect(r.dft).toBe(6);
    expect(round(r.spreadRate, 1)).toBe(160.4);
  });
  it("practical coverage with 15% loss", () => {
    const r = fromMils({ mils: 10, basis: "wft", lossPct: 15 });
    expect(round(r.practicalSpreadRate!, 1)).toBe(136.4); // 160.4167 × 0.85 = 136.354
  });
  it("0% loss: practical equals theoretical", () => {
    const r = fromMils({ mils: 10, basis: "wft", lossPct: 0 });
    expect(r.practicalSpreadRate).toBe(r.spreadRate);
  });
  it("WFT without volume solids: no DFT reported", () => {
    expect(fromMils({ mils: 10, basis: "wft" }).dft).toBeUndefined();
  });
  it("a DFT target without volume solids is refused", () => {
    expect(() => fromMils({ mils: 6, basis: "dft" })).toThrow(/volume solids/);
  });
  it.each([0, -1])("rejects %d mils", (mils) => {
    expect(() => fromMils({ mils, basis: "wft" })).toThrow(RangeError);
  });
  it.each([-1, 100, 150])("rejects loss %d%%", (lossPct) => {
    expect(() => fromMils({ mils: 10, basis: "wft", lossPct })).toThrow(RangeError);
  });
});
