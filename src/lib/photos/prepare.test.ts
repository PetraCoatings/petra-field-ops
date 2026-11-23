import { describe, expect, it } from "vitest";
import { fit } from "./prepare";

describe("photo sizing", () => {
  it("keeps the long edge at most 4096 px and the shape the same; never enlarges", () => {
    expect(fit(8064, 6048, 4096)).toEqual({ width: 4096, height: 3072 });
    expect(fit(3024, 4032, 4096)).toEqual({ width: 3024, height: 4032 });
    expect(fit(6000, 1000, 4096)).toEqual({ width: 4096, height: 683 });
    expect(fit(4032, 3024, 480)).toEqual({ width: 480, height: 360 });
  });
});
