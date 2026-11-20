import { describe, expect, it } from "vitest";
import { changedFields } from "./diff";

describe("changedFields", () => {
  it("shows only what changed on an update", () => {
    expect(
      changedFields(
        { id: "1", status: "scheduled", name: "Job", updated_at: "a" },
        { id: "1", status: "on_hold", name: "Job", updated_at: "b" },
      ),
    ).toEqual([{ field: "status", before: "scheduled", after: "on_hold" }]);
  });

  it("shows filled fields on an insert", () => {
    expect(changedFields(null, { id: "1", name: "Job", phone: null })).toEqual([{ field: "name", after: "Job" }]);
  });

  it("shows prior values on a delete", () => {
    expect(changedFields({ id: "1", name: "Job" }, null)).toEqual([{ field: "name", before: "Job" }]);
  });
});
