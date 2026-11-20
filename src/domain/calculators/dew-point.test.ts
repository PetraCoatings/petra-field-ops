import { describe, expect, it } from "vitest";
import {
  calculateDewPoint,
  cToF,
  deltaFToC,
  dewPointC,
  fToC,
  round1,
  substrateStatus,
} from "./dew-point";

describe("dewPointC (Magnus, a = 17.625, b = 243.04 °C)", () => {
  // Expected values hand-computed from the formula in the module comment.
  it.each([
    [20, 50, 9.2611],
    [25, 60, 16.6977],
    [10, 90, 8.4349],
  ])("%d °C at %d%% RH → %d °C", (t, rh, expected) => {
    expect(dewPointC(t, rh)).toBeCloseTo(expected, 4);
  });

  it("at 100% RH the dew point equals the air temperature", () => {
    expect(dewPointC(30, 100)).toBeCloseTo(30, 10);
    expect(dewPointC(-5, 100)).toBeCloseTo(-5, 10);
  });

  it.each([0, -10, 100.1, Number.NaN])("rejects RH %d", (rh) => {
    expect(() => dewPointC(20, rh)).toThrow(RangeError);
  });
});

describe("unit conversion", () => {
  it("readings", () => {
    expect(fToC(32)).toBe(0);
    expect(fToC(212)).toBe(100);
    expect(cToF(-40)).toBe(-40);
  });
  it("differences: a 5 °F margin is 2.78 °C", () => {
    expect(deltaFToC(5)).toBeCloseTo(2.7778, 4);
  });
});

describe("round1", () => {
  it.each([
    [50.5097, 50.5],
    [50.45, 50.5],
    [50.44, 50.4],
    [-0.05, -0.1],
    [-0.04, 0],
    [4.95, 5],
  ])("%d → %d", (x, expected) => {
    expect(round1(x)).toBe(expected);
  });
  it("never returns -0", () => {
    expect(Object.is(round1(-0.01), 0)).toBe(true);
  });
});

describe("substrateStatus", () => {
  it.each([
    [5, 5, "ok"],
    [12, 5, "ok"],
    [4.9, 5, "belowMargin"],
    [0.1, 5, "belowMargin"],
    [0, 5, "condensation"],
    [-3, 5, "condensation"],
  ] as const)("spread %d with margin %d → %s", (spread, margin, expected) => {
    expect(substrateStatus(spread, margin)).toBe(expected);
  });
});

describe("calculateDewPoint", () => {
  it("70 °F, 50% RH, substrate 60 °F → dew point 50.5 °F, 9.5° above, OK", () => {
    const r = calculateDewPoint({ unit: "F", airTemp: 70, relativeHumidity: 50, substrateTemp: 60, marginF: 5 });
    expect(r.dewPoint).toBe(50.5);
    expect(r.dewPointExact).toBeCloseTo(50.5097, 4);
    expect(r.margin).toBe(5);
    expect(r.minimumSubstrate).toBe(55.5);
    expect(r.spread).toBe(9.5);
    expect(r.status).toBe("ok");
    expect(r.outsideFormulaRange).toBe(false);
  });

  it("75 °F, 80% RH, substrate 72 °F → dew point 68.4 °F, only 3.6° above: below the 5° margin", () => {
    const r = calculateDewPoint({ unit: "F", airTemp: 75, relativeHumidity: 80, substrateTemp: 72, marginF: 5 });
    expect(r.dewPoint).toBe(68.4);
    expect(r.spread).toBe(3.6);
    expect(r.status).toBe("belowMargin");
  });

  it("substrate exactly the margin above the dew point passes", () => {
    const r = calculateDewPoint({ unit: "F", airTemp: 70, relativeHumidity: 50, substrateTemp: 55.5, marginF: 5 });
    expect(r.spread).toBe(5);
    expect(r.status).toBe("ok");
  });

  it("substrate at or below the dew point is condensation", () => {
    const r = calculateDewPoint({ unit: "F", airTemp: 50, relativeHumidity: 85, substrateTemp: 45, marginF: 5 });
    expect(r.dewPoint).toBe(45.7);
    expect(r.spread).toBe(-0.7);
    expect(r.status).toBe("condensation");
  });

  it("works in Celsius, converting the °F margin to °C", () => {
    const r = calculateDewPoint({ unit: "C", airTemp: 20, relativeHumidity: 50, substrateTemp: 12, marginF: 5 });
    expect(r.dewPoint).toBe(9.3);
    expect(r.margin).toBe(2.8);
    expect(r.minimumSubstrate).toBe(12.1);
    expect(r.spread).toBe(2.7);
    expect(r.status).toBe("belowMargin");
  });

  it("°F and °C give the same dew point for the same conditions", () => {
    const f = calculateDewPoint({ unit: "F", airTemp: 68, relativeHumidity: 50, marginF: 5 });
    const c = calculateDewPoint({ unit: "C", airTemp: 20, relativeHumidity: 50, marginF: 5 });
    expect(fToC(f.dewPointExact)).toBeCloseTo(c.dewPointExact, 10);
  });

  it("uses a product-specific margin when given", () => {
    const r = calculateDewPoint({ unit: "F", airTemp: 70, relativeHumidity: 50, substrateTemp: 60, marginF: 10 });
    expect(r.minimumSubstrate).toBe(60.5);
    expect(r.status).toBe("belowMargin");
  });

  it("without a substrate reading, only the dew point is reported", () => {
    const r = calculateDewPoint({ unit: "F", airTemp: 70, relativeHumidity: 50, marginF: 5 });
    expect(r.spread).toBeUndefined();
    expect(r.status).toBeUndefined();
  });

  it("handles freezing temperatures", () => {
    const r = calculateDewPoint({ unit: "F", airTemp: 20, relativeHumidity: 70, marginF: 5 });
    expect(r.dewPoint).toBeLessThan(20);
    expect(r.outsideFormulaRange).toBe(false);
  });

  it("flags air temperatures outside the formula's fitted range", () => {
    expect(calculateDewPoint({ unit: "F", airTemp: 130, relativeHumidity: 20, marginF: 5 }).outsideFormulaRange).toBe(true);
    expect(calculateDewPoint({ unit: "C", airTemp: -45, relativeHumidity: 50, marginF: 5 }).outsideFormulaRange).toBe(true);
  });

  it("rejects impossible humidity and a negative margin", () => {
    expect(() => calculateDewPoint({ unit: "F", airTemp: 70, relativeHumidity: 0, marginF: 5 })).toThrow(RangeError);
    expect(() => calculateDewPoint({ unit: "F", airTemp: 70, relativeHumidity: 50, marginF: -1 })).toThrow(RangeError);
  });
});
