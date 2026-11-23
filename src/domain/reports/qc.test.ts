import { describe, expect, it } from "vitest";
import { evaluate, limitText } from "./qc";

describe("QC results", () => {
  it("passes or fails only against a limit; limits are inclusive", () => {
    expect(evaluate(75, null, 75)).toBe("pass");
    expect(evaluate(75.1, null, 75)).toBe("fail");
    expect(evaluate(300, 300, null)).toBe("pass");
    expect(evaluate(4, 3, 5)).toBe("pass");
    expect(evaluate(6, 3, 5)).toBe("fail");
    expect(evaluate(1_000_000, null, null)).toBeNull();
  });
  it("describes the limit", () => {
    expect(limitText(null, 75, "% RH")).toBe("≤ 75 % RH");
    expect(limitText(300, null, "psi")).toBe("≥ 300 psi");
    expect(limitText(1e6, 1e9, "ohms", (n) => n.toExponential())).toBe("1e+6–1e+9 ohms");
    expect(limitText(null, null, "CSP")).toBeNull();
  });
});
