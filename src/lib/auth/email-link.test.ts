import { describe, expect, it } from "vitest";
import { parseAuthHash } from "./email-link";

describe("parseAuthHash", () => {
  it("reads the session from a default invitation link", () => {
    expect(parseAuthHash("#access_token=abc&expires_in=3600&refresh_token=def&token_type=bearer&type=invite")).toEqual({
      kind: "session",
      accessToken: "abc",
      refreshToken: "def",
    });
  });

  it("reports expired or used links", () => {
    expect(parseAuthHash("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid")).toEqual({
      kind: "error",
      code: "otp_expired",
    });
  });

  it("ignores empty or partial fragments", () => {
    expect(parseAuthHash("")).toEqual({ kind: "none" });
    expect(parseAuthHash("#access_token=abc")).toEqual({ kind: "none" });
  });
});
