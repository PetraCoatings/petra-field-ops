import { describe, expect, it } from "vitest";
import { calculateArea, shapeArea, SQFT_PER_SQM, type AreaInput } from "./area";

const rect = (length: number, width: number, operation: "add" | "subtract" = "add", quantity = 1): AreaInput => ({
  shape: "rectangle",
  operation,
  quantity,
  length,
  width,
});

describe("shapeArea", () => {
  it("rectangle = length × width", () => {
    expect(shapeArea(rect(50, 40))).toBe(2000);
  });
  it("triangle = base × height ÷ 2", () => {
    expect(shapeArea({ shape: "triangle", operation: "add", quantity: 1, base: 10, height: 6 })).toBe(30);
  });
  it("circle = π × diameter² ÷ 4", () => {
    expect(shapeArea({ shape: "circle", operation: "add", quantity: 1, diameter: 2 })).toBeCloseTo(Math.PI, 12);
  });
  it("zero dimension gives zero area", () => {
    expect(shapeArea(rect(0, 40))).toBe(0);
  });
});

describe("calculateArea", () => {
  it("a single room", () => {
    expect(calculateArea([rect(50, 40)])).toEqual({
      lines: [{ each: 2000, total: 2000, signed: 2000 }],
      added: 2000,
      subtracted: 0,
      net: 2000,
    });
  });

  it("adds several areas and subtracts columns and a pit", () => {
    // Warehouse 120' × 80' + office 20' 6" × 15' − 6 columns 2' × 2' − pit 8' × 4'
    const r = calculateArea([rect(120, 80), rect(20.5, 15), rect(2, 2, "subtract", 6), rect(8, 4, "subtract")]);
    expect(r.added).toBe(9600 + 307.5);
    expect(r.subtracted).toBe(24 + 32);
    expect(r.net).toBe(9851.5);
    expect(r.lines[2]).toEqual({ each: 4, total: 24, signed: -24 });
  });

  it("feet-and-inches entries give the same answer as decimals", () => {
    // 12' 6" × 10' 3" = 12.5 × 10.25
    expect(calculateArea([rect(12 + 6 / 12, 10 + 3 / 12)]).net).toBe(128.125);
  });

  it("subtracting round column bases", () => {
    // 4 round bases, 18" diameter, out of a 30' × 30' slab
    const r = calculateArea([rect(30, 30), { shape: "circle", operation: "subtract", quantity: 4, diameter: 1.5 }]);
    expect(r.subtracted).toBeCloseTo(4 * Math.PI * 0.5625, 10);
    expect(r.net).toBeCloseTo(900 - 7.0685835, 6);
  });

  it("an empty list is zero", () => {
    expect(calculateArea([])).toEqual({ lines: [], added: 0, subtracted: 0, net: 0 });
  });

  it("subtracting more than was added gives a negative net (the screen flags it)", () => {
    expect(calculateArea([rect(10, 10), rect(20, 10, "subtract")]).net).toBe(-100);
  });

  it("square metres conversion constant", () => {
    expect(1000 / SQFT_PER_SQM).toBeCloseTo(92.903, 3);
  });
});
