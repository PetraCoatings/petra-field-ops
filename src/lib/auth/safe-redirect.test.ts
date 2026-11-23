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

describe("safeNextPath refuses tricks that browsers turn into another site", () => {
  it.each(["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\r\\evil.example", "/x\\..\\evil", "/%0A", "/\u0000x"])("%j", (v) => {
    const r = safeNextPath(decodeURIComponent(encodeURIComponent(v)), "/home");
    expect(new URL(r, "https://app.example").origin).toBe("https://app.example");
  });
  it("keeps normal paths, queries and fragments", () => {
    expect(safeNextPath("/jobs/1?tab=past#wo-2")).toBe("/jobs/1?tab=past#wo-2");
    expect(safeNextPath("/\t/evil.example", "/home")).toBe("/home");
  });
});
