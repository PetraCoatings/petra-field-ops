/**
 * Square footage: a list of areas, each added to or subtracted from the total.
 *
 * Typical use: add the main floor rectangle(s), then subtract columns, pits,
 * equipment pads or anything else that won't be coated. Every area has a
 * quantity, so "4 columns, 2' × 2'" is one line.
 *
 * Pure functions, no rounding: the screen rounds for display only.
 */

export type AreaShape = "rectangle" | "triangle" | "circle";
export type AreaOperation = "add" | "subtract";

/** Dimensions are in decimal feet (see parseLength). */
export type AreaInput =
  | { shape: "rectangle"; operation: AreaOperation; quantity: number; length: number; width: number }
  | { shape: "triangle"; operation: AreaOperation; quantity: number; base: number; height: number }
  | { shape: "circle"; operation: AreaOperation; quantity: number; diameter: number };

export type AreaLine = {
  /** Area of one piece, in ft². */
  each: number;
  /** each × quantity, always positive. */
  total: number;
  /** +total for "add", −total for "subtract". */
  signed: number;
};

export type AreaResult = {
  lines: AreaLine[];
  added: number;
  subtracted: number;
  net: number;
};

export const SQFT_PER_SQYD = 9;
export const SQFT_PER_SQM = 10.763910416709722; // 1 m = 3.28084 ft exactly (0.3048 m/ft)

/** Area of one piece of the given shape, in ft². */
export function shapeArea(a: AreaInput): number {
  switch (a.shape) {
    case "rectangle":
      return a.length * a.width;
    case "triangle":
      return (a.base * a.height) / 2;
    case "circle":
      return (Math.PI * a.diameter * a.diameter) / 4;
  }
}

export function calculateArea(areas: readonly AreaInput[]): AreaResult {
  const lines = areas.map((a): AreaLine => {
    const each = shapeArea(a);
    const total = each * a.quantity;
    return { each, total, signed: a.operation === "subtract" ? -total : total };
  });
  const added = lines.reduce((s, l) => (l.signed > 0 ? s + l.total : s), 0);
  const subtracted = lines.reduce((s, l) => (l.signed < 0 ? s + l.total : s), 0);
  return { lines, added, subtracted, net: added - subtracted };
}
