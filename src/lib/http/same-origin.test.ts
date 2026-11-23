import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { NextRequest } from "next/server";
import { isSameOriginJson } from "./same-origin";

const req = (headers: Record<string, string>) => new NextRequest("https://petra-field-ops.vercel.app/api/sync/clock", { method: "POST", headers });

describe("send-queue routes accept only this site's own JSON", () => {
  it("accepts the app's own requests", () => {
    expect(isSameOriginJson(req({ "content-type": "application/json", origin: "https://petra-field-ops.vercel.app", "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOriginJson(req({ "content-type": "application/json; charset=utf-8" }))).toBe(true);
  });

  it("refuses cross-site posts and plain-text bodies", () => {
    expect(isSameOriginJson(req({ "content-type": "text/plain", origin: "https://petra-field-ops.vercel.app" }))).toBe(false);
    expect(isSameOriginJson(req({ "content-type": "application/json", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOriginJson(req({ "content-type": "application/json", origin: "https://evil.example", host: "petra-field-ops.vercel.app" }))).toBe(false);
    expect(isSameOriginJson(req({ "content-type": "application/json", origin: "null" }))).toBe(false);
  });
});
