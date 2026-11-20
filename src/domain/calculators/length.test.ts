import { describe, expect, it } from "vitest";
import { formatFeetInches, parseFeetAndInches, parseLength } from "./length";

const feet = (s: string) => {
  const r = parseLength(s);
  if (!r.ok) throw new Error(`${s}: ${r.error}`);
  return r.feet;
};

describe("parseLength", () => {
  it.each([
    ["12", 12],
    ["12.5", 12.5],
    [".5", 0.5],
    ["12.5'", 12.5],
    ["12.5 ft", 12.5],
    ["12.5ft.", 12.5],
    ["12 feet", 12],
    ["1 foot", 1],
    ["12'6\"", 12.5],
    ["12' 6\"", 12.5],
    ["12' 6", 12.5],
    ["12ft 6in", 12.5],
    ["12 ft 6 in", 12.5],
    ["12' 0\"", 12],
    ["0' 6\"", 0.5],
    ["150\"", 12.5],
    ["150 in", 12.5],
    ["6 inches", 0.5],
    ["6''", 0.5],
    ["12 1/2'", 12.5],
    ["1/2'", 0.5],
    ["12' 6 1/2\"", 12 + 6.5 / 12],
    ["12' 6-1/2\"", 12 + 6.5 / 12],
    ["12′ 6″", 12.5],
    ["12’ 6”", 12.5],
    ["  12.5  ", 12.5],
    ["1,200", 1200],
    ["1,200.5", 1200.5],
    ["12,5", 12.5],
    ["0", 0],
  ])("%s → %d ft", (input, expected) => {
    expect(feet(input)).toBeCloseTo(expected, 10);
  });

  it.each([
    ["", "empty"],
    ["   ", "empty"],
    ["abc", "invalid"],
    ["-12", "invalid"],
    ["12 6", "invalid"],
    ["12-6", "invalid"],
    ["12'6'", "invalid"],
    ["1/0", "invalid"],
    ["12' 12\"", "inchesTooLarge"],
    ["12' 14", "inchesTooLarge"],
  ])("rejects %j (%s)", (input, error) => {
    expect(parseLength(input)).toEqual({ ok: false, error });
  });
});

describe("formatFeetInches", () => {
  it.each([
    [12.5, "12' 6\""],
    [12, "12' 0\""],
    [0.5, "0' 6\""],
    [12 + 6.5 / 12, "12' 6 1/2\""],
    [12 + 6.125 / 12, "12' 6 1/8\""],
    [12 + 6.75 / 12, "12' 6 3/4\""],
    [11.999, "12' 0\""], // rounds to the nearest 1/8" and carries into feet
    [0, "0' 0\""],
  ])("%d → %s", (input, expected) => {
    expect(formatFeetInches(input)).toBe(expected);
  });
});

describe("parseFeetAndInches", () => {
  it.each([
    ["12", "6", 12.5],
    ["12.5", "", 12.5],
    ["", "18", 1.5],
    ["12", "6 1/2", 12 + 6.5 / 12],
    ["12", "6.5", 12 + 6.5 / 12],
    ["12'", "6\"", 12.5],
    ["12 ft", "6 in", 12.5],
    ["12", "0", 12],
    ["0", "6", 0.5],
    ["12,5", "", 12.5],
  ])("%j ft %j in → %d ft", (ft, inch, expected) => {
    const r = parseFeetAndInches(ft, inch);
    expect(r.ok && r.feet).toBeCloseTo(expected, 10);
  });

  it.each([
    ["", "", "empty"],
    [" ", " ", "empty"],
    ["12", "12", "inchesTooLarge"],
    ["abc", "", "invalid"],
    ["12'6", "", "invalid"],
    ["-12", "", "invalid"],
    ["12", "x", "invalid"],
  ])("%j ft %j in → %s", (ft, inch, error) => {
    expect(parseFeetAndInches(ft, inch)).toEqual({ ok: false, error });
  });
});
