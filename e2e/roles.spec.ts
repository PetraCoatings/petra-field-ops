import { expect, test, type Page } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled, type RoleUser, type TestRole } from "./support/role-users";

/**
 * Signed-in tests: every role signs in for real against a DEV Supabase project
 * and is checked against what it may and may not open. Skipped unless the
 * E2E_SUPABASE_* variables are set (see docs/SETUP.md).
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

const ROLE_LABEL: Record<TestRole, string> = {
  installer: "Installer",
  crew_lead: "Crew Lead",
  project_manager: "Project Manager",
  office_admin: "Office Administrator",
};

const MANAGE_PAGES: { path: string; heading: string; roles: TestRole[] }[] = [
  { path: "/manage", heading: "Dashboard", roles: ["project_manager", "office_admin"] },
  { path: "/manage/projects", heading: "Jobs", roles: ["project_manager", "office_admin"] },
  { path: "/manage/templates", heading: "Work order templates", roles: ["project_manager", "office_admin"] },
  { path: "/manage/library", heading: "Products & SDS", roles: ["project_manager", "office_admin"] },
  { path: "/manage/employees", heading: "Employees", roles: ["office_admin"] },
  { path: "/manage/settings", heading: "Company Settings", roles: ["office_admin"] },
  { path: "/manage/audit", heading: "Audit Log", roles: ["office_admin"] },
];

function user(role: TestRole): RoleUser {
  const u = readRoleUsers().find((x) => x.role === role);
  if (!u) throw new Error(`no test login for ${role}`);
  return u;
}

async function signIn(page: Page, u: RoleUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: `Hi, ${u.firstName}` })).toBeVisible();
  await expect(page.getByText(ROLE_LABEL[u.role], { exact: true })).toBeVisible();
}

for (const role of Object.keys(ROLE_LABEL) as TestRole[]) {
  test(`${ROLE_LABEL[role]} can sign in and reaches only the right pages`, async ({ page }) => {
    // Two screen sizes are enough here and keep us under Supabase's sign-in rate limit.
    test.skip(test.info().project.name === "android", "phone and desktop cover sign-in");
    const u = user(role);
    await signIn(page, u);

    // Every role sees the same six field tiles.
    for (const tile of ["Time Clock", "Calculators", "Calendar", "Job Center", "Product Data Sheets", "Safety Data Sheets"]) {
      await expect(page.getByRole("link", { name: tile })).toBeVisible();
    }

    for (const p of MANAGE_PAGES) {
      await page.goto(p.path);
      if (p.roles.includes(role)) {
        await expect(page, `${role} should open ${p.path}`).toHaveURL(new RegExp(`${p.path}$`));
        await expect(page.getByRole("heading", { name: p.heading, level: 1 })).toBeVisible();
      } else {
        await expect(page, `${role} must be turned away from ${p.path}`).toHaveURL(/\/\?denied=1$/);
        await expect(page.getByText("You don't have access to that page.")).toBeVisible();
      }
    }

    // Management always has a way back to the field app (the installed phone
    // app has no browser back button).
    if (MANAGE_PAGES[0].roles.includes(role)) {
      await page.goto("/manage/projects");
      await page.getByRole("link", { name: "Field app" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { name: `Hi, ${u.firstName}` })).toBeVisible();
    }

    // Signing out ends the session.
    await page.goto("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
}
