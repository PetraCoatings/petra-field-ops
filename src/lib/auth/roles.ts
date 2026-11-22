/**
 * Roles and what each role may reach in the app's navigation.
 *
 * IMPORTANT: this only decides what to SHOW. Every capability is also
 * enforced on the server (lib/auth/dal.ts) and in the database (RLS).
 */
export const ROLES = ["installer", "crew_lead", "project_manager", "office_admin"] as const;
export type AppRole = (typeof ROLES)[number];

export function isAppRole(v: unknown): v is AppRole {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

/** The six modules on the field home screen — identical for every role. */
export const FIELD_MODULES = [
  { key: "timeClock", href: "/time-clock" },
  { key: "calculators", href: "/calculators" },
  { key: "calendar", href: "/calendar" },
  { key: "jobCenter", href: "/jobs" },
  { key: "productData", href: "/products" },
  { key: "safetyData", href: "/sds" },
] as const;
export type FieldModuleKey = (typeof FIELD_MODULES)[number]["key"];

export type ManageNavKey =
  | "dashboard"
  | "projects"
  | "templates"
  | "employees"
  | "settings"
  | "auditLog";

const MANAGE_NAV: {
  key: ManageNavKey;
  href: string;
  roles: readonly AppRole[];
  /** Match only this exact path, not its sub-paths. */
  exact?: boolean;
}[] = [
  { key: "dashboard", href: "/manage", roles: ["project_manager", "office_admin"], exact: true },
  { key: "projects", href: "/manage/projects", roles: ["project_manager", "office_admin"] },
  { key: "templates", href: "/manage/templates", roles: ["project_manager", "office_admin"] },
  { key: "employees", href: "/manage/employees", roles: ["office_admin"] },
  { key: "settings", href: "/manage/settings", roles: ["office_admin"] },
  { key: "auditLog", href: "/manage/audit", roles: ["office_admin"] },
];

export function canAccessManagement(role: AppRole): boolean {
  return role === "project_manager" || role === "office_admin";
}

export function manageNavFor(role: AppRole) {
  return MANAGE_NAV.filter((item) => item.roles.includes(role)).map(({ key, href, exact }) => ({ key, href, exact: Boolean(exact) }));
}

/** Can this role open the given management path? Used by page guards. */
export function canOpenManagePath(role: AppRole, pathname: string): boolean {
  const match = [...MANAGE_NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((i) => pathname === i.href || (!i.exact && pathname.startsWith(`${i.href}/`)));
  return match ? match.roles.includes(role) : false;
}
