import { describe, expect, it } from "vitest";
import { parseDateOnly } from "./dates";

describe("parseDateOnly", () => {
  it("keeps the calendar day in Central time", () => {
    const d = parseDateOnly("2026-12-01");
    const shown = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "short" }).format(d);
    expect(shown).toBe("12/1/26");
  });
});
