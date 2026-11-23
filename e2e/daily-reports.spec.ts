import { randomBytes } from "node:crypto";
import { devices, expect, test, type Browser } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { addLibraryItem, createTestProject, deleteTestProject, employeeId, updateTestProject } from "./support/test-project";

/**
 * Daily field reports: the crew lead fills one in (readings with the product's
 * dew point margin, material with the actual spread rate), saves, handles a
 * save from a second phone, submits; the PM is notified and sends it back;
 * the lead fixes and resubmits; the PM accepts. Both versions are kept.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

async function signIn(browser: Browser, u: RoleUser) {
  const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  const page = await c.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  return { c, page };
}

test("daily report: fill in, conflict, submit, send back, resubmit, accept", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.skip((await api("/rest/v1/daily_field_reports?select=id&limit=1")).status === 404, "apply supabase/migrations/20261128000100_daily_reports.sql first");
  test.setTimeout(180_000);
  const users = readRoleUsers();
  const lead = users.find((x) => x.role === "crew_lead")!;
  const installer = users.find((x) => x.role === "installer")!;
  const pm = users.find((x) => x.role === "project_manager")!;
  const admin = users.find((x) => x.role === "office_admin")!;
  const job = await createTestProject([lead, installer]);
  await updateTestProject(job.id, { crew_lead_id: await employeeId(lead), project_manager_id: await employeeId(pm) });
  const product = `E2E ${randomBytes(3).toString("hex")} Epoxy`;
  await addLibraryItem(admin, { kind: "product", name: product, approved: true, specs: { recommended_coverage_sqft_per_gal: 160, min_substrate_above_dew_point_f: 8 } });

  const ld = await signIn(browser, lead);
  const ld2 = await signIn(browser, lead); // the same crew lead on a second phone
  const office = await signIn(browser, pm);
  const crew = await signIn(browser, installer);
  try {
    const page = ld.page;
    await page.goto(`/jobs/${job.id}`);
    await page.getByRole("button", { name: "Start today's report" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}/reports/\\d{4}-\\d{2}-\\d{2}$`));
    const reportUrl = new URL(page.url()).pathname;
    await expect(page.getByRole("region", { name: "Crew on site" }).getByRole("checkbox").first()).toBeChecked();
    await page.getByLabel("Work performed").fill("Ground the floor and primed bays 1–3.");
    await page.getByLabel("Square feet completed").fill("6620");

    // Reading with the product: 6.5° above the dew point isn't enough for its 8° margin.
    await page.getByRole("button", { name: "Add a reading" }).click();
    const reading = page.getByRole("group", { name: "Reading 1" });
    await reading.getByLabel("Air temp").fill("70");
    await reading.getByLabel("Humidity %").fill("50");
    await reading.getByLabel("Surface temp").fill("57");
    await reading.getByLabel("Product being applied").selectOption({ label: product });
    await expect(reading.getByRole("alert")).toContainText("Do not coat: only 6.5 °F above, needs 8 °F");
    await expect(reading.getByRole("alert")).toContainText("product margin 8 °F");

    await page.getByRole("button", { name: "Add material" }).click();
    const material = page.getByRole("group", { name: "Material 1" });
    await material.getByLabel("Product", { exact: true }).selectOption({ label: product });
    await material.getByLabel("Gallons").fill("45");
    await material.getByLabel("Area (sf)").fill("6620");
    await expect(material).toContainText("Actual 147.1 SF/gal · data sheet 160 SF/gal, -8.1%");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Draft saved at/)).toBeVisible();

    // The second phone (opened earlier version) saves; then the first phone saves again → choose.
    await ld2.page.goto(reportUrl);
    await ld2.page.getByLabel("Plan for tomorrow").fill("Topcoat");
    await ld2.page.getByRole("button", { name: "Save draft" }).click();
    await expect(ld2.page.getByText(/Draft saved at/)).toBeVisible();
    await page.getByLabel("Notes, delays, issues").fill("Waited for the slab to warm up.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/saved from another phone/)).toBeVisible();
    await page.getByRole("button", { name: "Keep mine (replace it)" }).click();
    await expect(page.getByText(/Draft saved at/)).toBeVisible();

    await page.getByRole("button", { name: "Submit report" }).click();
    await page.getByRole("button", { name: "Yes, submit" }).click();
    await expect(page.getByRole("region", { name: "Report status" })).toContainText("Submitted");

    // ---- The crew can read it, not edit it
    await crew.page.goto(reportUrl);
    await expect(crew.page.getByText("Ground the floor and primed bays 1–3.")).toBeVisible();
    await expect(crew.page.getByRole("button", { name: "Save draft" })).toHaveCount(0);
    await expect(crew.page.getByRole("region", { name: "Review this report" })).toHaveCount(0);

    // ---- The PM is notified and sends it back
    await office.page.goto("/notifications");
    await office.page.getByRole("button", { name: /Daily report submitted/ }).filter({ hasText: job.name }).click();
    await expect(office.page).toHaveURL(new RegExp(reportUrl));
    await expect(office.page.getByText("Do not coat: only 6.5 °F above, needs 8 °F")).toBeVisible();
    await office.page.getByLabel("Or send it back. What needs correcting?").fill("Add the lot number");
    await office.page.getByRole("button", { name: "Send back for corrections" }).click();
    await expect(office.page.getByRole("region", { name: "Report status" })).toContainText("Sent back for corrections");

    // ---- The lead fixes and resubmits
    await page.goto("/notifications");
    await page.getByRole("button", { name: /sent back for corrections/ }).filter({ hasText: job.name }).click();
    await expect(page.getByText("The office asked for corrections: Add the lot number.")).toBeVisible();
    await page.getByRole("group", { name: "Material 1" }).getByLabel("Lot #").fill("A12345");
    await page.getByRole("button", { name: "Submit report" }).click();
    await page.getByRole("button", { name: "Yes, submit" }).click();
    await expect(page.getByRole("region", { name: "Report status" })).toContainText("version 2");

    // ---- The PM accepts; both versions are kept
    await office.page.reload();
    await office.page.getByRole("button", { name: "Accept report" }).click();
    await expect(office.page.getByRole("region", { name: "Report status" })).toContainText("Accepted");
    await expect(office.page.getByText("lot A12345")).toBeVisible();
    await office.page.getByRole("link", { name: /Version 1/ }).click();
    await expect(office.page.getByText("lot A12345")).toHaveCount(0);
    await expect(office.page.getByText("Waited for the slab to warm up.")).toBeVisible();
  } finally {
    for (const x of [ld, ld2, office, crew]) await x.c.close();
    await deleteTestProject(job.id);
  }
});
