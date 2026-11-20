import { describe, expect, it } from "vitest";
import { formatNumber, parseDecimal } from "./number";

describe("parseDecimal", () => {
  it.each([
    ["12", 12],
    ["12.5", 12.5],
    ["12,5", 12.5],
    ["-3", -3],
    ["−3.5", -3.5],
    [".5", 0.5],
    ["1,200", 1200],
    ["1,200.75", 1200.75],
    ["  70 ", 70],
  ])("%j → %d", (raw, expected) => {
    expect(parseDecimal(raw)).toBe(expected);
  });
  it("empty is null", () => {
    expect(parseDecimal("  ")).toBeNull();
  });
  it.each(["abc", "1.2.3", "12°", "--1", "1-"])("%j is NaN", (raw) => {
    expect(parseDecimal(raw)).toBeNaN();
  });
});

describe("formatNumber", () => {
  it("formats with the locale's separators", () => {
    expect(formatNumber("en", 9851.5)).toBe("9,851.50");
    expect(formatNumber("en", 50.5, 1)).toBe("50.5");
  });
  it("never shows negative zero", () => {
    expect(formatNumber("en", -0)).toBe("0.00");
  });
});
