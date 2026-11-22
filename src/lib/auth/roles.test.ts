import { describe, expect, it } from "vitest";
import { FIELD_MODULES, canAccessManagement, canOpenManagePath, manageNavFor } from "./roles";
import { isPublicPath } from "./public-paths";

describe("field home screen", () => {
  it("shows exactly the six required modules, Time Clock first", () => {
    expect(FIELD_MODULES.map((m) => m.key)).toEqual([
      "timeClock",
      "calculators",
      "calendar",
      "jobCenter",
      "productData",
      "safetyData",
    ]);
  });
});

describe("management access", () => {
  it("is limited to project managers and office admins", () => {
    expect(canAccessManagement("installer")).toBe(false);
    expect(canAccessManagement("crew_lead")).toBe(false);
    expect(canAccessManagement("project_manager")).toBe(true);
    expect(canAccessManagement("office_admin")).toBe(true);
  });

  it("gives project managers projects but not employees, settings or audit", () => {
    expect(manageNavFor("project_manager").map((i) => i.key)).toEqual(["dashboard", "projects", "templates"]);
    expect(canOpenManagePath("project_manager", "/manage/projects/abc")).toBe(true);
    expect(canOpenManagePath("project_manager", "/manage/templates/abc")).toBe(true);
    expect(canOpenManagePath("project_manager", "/manage/employees")).toBe(false);
    expect(canOpenManagePath("project_manager", "/manage/employees/123")).toBe(false);
    expect(canOpenManagePath("project_manager", "/manage/settings")).toBe(false);
    expect(canOpenManagePath("project_manager", "/manage/audit")).toBe(false);
  });

  it("gives office admins everything", () => {
    expect(manageNavFor("office_admin").map((i) => i.key)).toEqual([
      "dashboard",
      "projects",
      "templates",
      "employees",
      "settings",
      "auditLog",
    ]);
  });

  it("gives field roles nothing, even by typing the URL", () => {
    for (const role of ["installer", "crew_lead"] as const) {
      expect(manageNavFor(role)).toEqual([]);
      expect(canOpenManagePath(role, "/manage")).toBe(false);
      expect(canOpenManagePath(role, "/manage/projects")).toBe(false);
    }
  });

  it("denies unknown management paths by default", () => {
    expect(canOpenManagePath("office_admin", "/manage/something-new")).toBe(false);
  });
});

describe("public paths", () => {
  it("only sign-in and email-link pages are public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/forgot-password")).toBe(true);
    expect(isPublicPath("/auth/confirm")).toBe(true);
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/manage")).toBe(false);
    expect(isPublicPath("/jobs/123")).toBe(false);
    expect(isPublicPath("/login-bypass")).toBe(false);
    expect(isPublicPath("/authx")).toBe(false);
  });
});
