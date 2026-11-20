import { describe, expect, it } from "vitest";
import { bool, decimalString, isEmail, positiveInt, str } from "./form-state";

describe("form helpers", () => {
  it("trims strings and turns blanks into null", () => {
    const fd = new FormData();
    fd.set("a", "  hello ");
    fd.set("b", "   ");
    expect(str(fd, "a")).toBe("hello");
    expect(str(fd, "b")).toBeNull();
    expect(str(fd, "missing")).toBeNull();
  });

  it("reads checkboxes", () => {
    const fd = new FormData();
    fd.set("on", "on");
    expect(bool(fd, "on")).toBe(true);
    expect(bool(fd, "off")).toBe(false);
  });

  it("validates emails", () => {
    expect(isEmail("crew@petra.test")).toBe(true);
    expect(isEmail("not-an-email")).toBe(false);
    expect(isEmail(null)).toBe(false);
  });

  it("keeps square footage as an exact decimal string", () => {
    expect(decimalString("1,180")).toBe("1180");
    expect(decimalString("1180.25")).toBe("1180.25");
    expect(decimalString("-5")).toBe("invalid");
    expect(decimalString("12ft")).toBe("invalid");
    expect(decimalString(null)).toBeNull();
  });

  it("accepts only positive whole numbers for durations", () => {
    expect(positiveInt("5")).toBe(5);
    expect(positiveInt("0")).toBe("invalid");
    expect(positiveInt("2.5")).toBe("invalid");
    expect(positiveInt(null)).toBeNull();
  });
});
