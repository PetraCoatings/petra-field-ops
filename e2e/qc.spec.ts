import { devices, expect, test, type Browser } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { createTestProject, deleteTestProject, employeeId, updateTestProject } from "./support/test-project";
import { signInAs } from "./support/sign-in";

/**
 * QC: the PM sets the tests a job needs (with and without limits); the crew
 * lead records readings; pass/fail appears only where a limit exists.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

async function signIn(browser: Browser, u: RoleUser) {
  const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  const page = await c.newPage();
  await signInAs(page, u);
  await expect(page).toHaveURL(/\/$/);
  return { c, page };
}

test("QC: required tests, readings, pass/fail only with a limit", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.skip((await api("/rest/v1/qc_test_types?select=id&limit=1")).status === 404, "apply supabase/migrations/20261128000300_qc.sql first");
  test.setTimeout(150_000);
  const users = readRoleUsers();
  const lead = users.find((x) => x.role === "crew_lead")!;
  const installer = users.find((x) => x.role === "installer")!;
  const pm = users.find((x) => x.role === "project_manager")!;
  const job = await createTestProject([lead, installer]);
  await updateTestProject(job.id, { crew_lead_id: await employeeId(lead), project_manager_id: await employeeId(pm) });
  const office = await signIn(browser, pm);
  const ld = await signIn(browser, lead);
  const crew = await signIn(browser, installer);
  try {
    // ---- The PM sets the tests
    await office.page.goto(`/jobs/${job.id}`);
    const qc = office.page.getByRole("region", { name: "Quality control" });
    const add = async (test: string, min: string, max: string) => {
      await qc.getByLabel("Test", { exact: true }).first().selectOption({ label: test });
      await qc.getByLabel("Minimum (optional)").fill(min);
      await qc.getByLabel("Maximum (optional)").fill(max);
      await qc.getByRole("button", { name: "Add test" }).click();
      await expect(qc.getByText("Test added.")).toBeVisible();
    };
    await add("Moisture: relative humidity (in-slab probe) (% RH)", "", "75");
    await office.page.reload();
    await add("Pull-off adhesion (psi)", "300", "");
    await office.page.reload();
    await add("Surface profile (CSP) (CSP)", "", "");
    await office.page.reload();
    await expect(qc).toContainText("Limit: ≤ 75 % RH");
    await expect(qc).toContainText("Limit: ≥ 300 psi");
    await expect(qc).toContainText("No limit set: readings are recorded, not judged");

    // ---- The crew lead records readings
    const page = ld.page;
    await page.goto(`/jobs/${job.id}`);
    const lqc = page.getByRole("region", { name: "Quality control" });
    const record = async (test: RegExp, value: string, where: string) => {
      await lqc.getByLabel("Test", { exact: true }).selectOption({ label: (await lqc.getByLabel("Test", { exact: true }).locator("option").filter({ hasText: test }).first().textContent())! });
      await lqc.getByLabel("Reading", { exact: true }).fill(value);
      await lqc.getByLabel("Where").fill(where);
      await lqc.getByRole("button", { name: "Save reading" }).click();
      await expect(lqc.getByText("Reading saved.")).toBeVisible();
      await page.reload();
    };
    await record(/relative humidity/, "72.5", "Bay 1");
    await record(/relative humidity/, "81", "Bay 2");
    await record(/adhesion/, "250", "Bay 3");
    await record(/CSP/, "3", "Bay 1");
    await record(/Surface pH/, "9", "Bay 1"); // not a required test
    const readings = lqc.getByRole("list", { name: "Readings" }).getByRole("listitem");
    await expect(readings.filter({ hasText: "72.5 % RH" })).toContainText("Pass");
    await expect(readings.filter({ hasText: "81 % RH" })).toContainText("Fail");
    await expect(readings.filter({ hasText: "250 psi" })).toContainText("Fail");
    await expect(readings.filter({ hasText: "3 CSP" })).toContainText("Recorded");
    await expect(readings.filter({ hasText: "3 CSP" })).not.toContainText("Pass");
    await expect(readings.filter({ hasText: "9 pH" })).toContainText("Recorded");

    // ---- The installer reads them but can't record
    await crew.page.goto(`/jobs/${job.id}`);
    const cqc = crew.page.getByRole("region", { name: "Quality control" });
    await expect(cqc.getByText("81 % RH")).toBeVisible();
    await expect(cqc.getByRole("button", { name: "Save reading" })).toHaveCount(0);
    await expect(cqc.getByRole("button", { name: "Add test" })).toHaveCount(0);
  } finally {
    for (const x of [office, ld, crew]) await x.c.close();
    await deleteTestProject(job.id);
  }
});
