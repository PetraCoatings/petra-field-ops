import { describe, expect, it } from "vitest";
import { safeNextPath } from "./safe-redirect";

describe("safeNextPath", () => {
  it("allows local paths", () => {
    expect(safeNextPath("/set-password")).toBe("/set-password");
    expect(safeNextPath("/jobs/123?tab=photos")).toBe("/jobs/123?tab=photos");
  });
  it("rejects other sites and tricks", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
    expect(safeNextPath("javascript:alert(1)")).toBe("/");
    expect(safeNextPath(null)).toBe("/");
  });
});
