import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { checklistsTableExists, createTestProject, deleteTestProject, employeeId, publishAsOffice, updateTestProject } from "./support/test-project";

/**
 * Loading checklist: the crew lead builds it from the work order's trailer
 * list, ticks items, flags one missing with a note and adds an item; the
 * installer can only look; the project manager is notified and sees the
 * missing item; after a new revision the checklist is brought up to date.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

async function signIn(browser: Browser, u: RoleUser, phone: boolean): Promise<Page> {
  const context = await browser.newContext({ ...(phone ? devices["iPhone 13"] : devices["Desktop Chrome"]), baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

const trailer = (extra: { item: string; qty?: string }[] = []) => ({
  v: 1,
  trailerMaterials: [{ item: "Sika 264 (4.5 Gallon kit + Bag)", qty: "10" }, { item: "Sika 200C (3.31 Gal Kit)", qty: "19 Kits + Partial" }, { item: "Floor Buffers" }, ...extra],
});

test("crew lead loads the trailer; installer watches; office is told what's missing", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one run covers all three screens (and limits sign-ins)");
  test.skip(!(await checklistsTableExists()), "apply supabase/migrations/20261123000100_loading_checklists.sql to the dev project first");
  test.setTimeout(150_000);

  const users = readRoleUsers();
  const pm = users.find((x) => x.role === "project_manager")!;
  const lead = users.find((x) => x.role === "crew_lead")!;
  const installer = users.find((x) => x.role === "installer")!;
  const job = await createTestProject([installer, lead]);
  try {
    await updateTestProject(job.id, { project_manager_id: await employeeId(pm) });
    const fwoId = await publishAsOffice(pm, job.id, trailer());

    // ---- Crew lead starts and works the checklist
    const l = await signIn(browser, lead, true);
    await l.goto(`/jobs/${job.id}`);
    await expect(l.getByRole("link", { name: /Loading checklist/ })).toContainText("Not started");
    await l.getByRole("link", { name: /Loading checklist/ }).click();
    await expect(l.getByText("0 of 3 loaded")).toBeVisible();
    await l.getByRole("button", { name: "Loaded: Sika 264 (4.5 Gallon kit + Bag)" }).click();
    await l.getByRole("button", { name: "Missing: Sika 200C (3.31 Gal Kit)" }).click();
    await l.getByLabel("Note for Sika 200C (3.31 Gal Kit)").fill("Only 18 kits in the shop");
    await l.getByRole("button", { name: "Save", exact: true }).click();
    await expect(l.getByText("1 of 3 loaded")).toBeVisible();
    await expect(l.getByText("1 missing")).toBeVisible();
    await l.getByLabel("Item", { exact: true }).fill("Extra roller covers");
    await l.getByLabel("Quantity", { exact: true }).fill("6");
    await l.getByRole("button", { name: "Add", exact: true }).click();
    await expect(l.getByText("Extra roller covers")).toBeVisible();
    // Saved on the server, not just on screen.
    await l.reload();
    await expect(l.getByText("1 of 4 loaded")).toBeVisible();
    await expect(l.getByText("Only 18 kits in the shop")).toBeVisible();
    await expect(l.getByRole("button", { name: "Loaded: Sika 264 (4.5 Gallon kit + Bag)" })).toHaveAttribute("aria-pressed", "true");

    // ---- Installer can follow along but not tick
    const i = await signIn(browser, installer, true);
    await i.goto(`/jobs/${job.id}`);
    await expect(i.getByRole("link", { name: /Loading checklist/ })).toContainText("1 of 4 loaded · 1 missing");
    await i.getByRole("link", { name: /Loading checklist/ }).click();
    await expect(i.getByText("The crew lead checks items off.")).toBeVisible();
    await expect(i.getByRole("button", { name: /^Loaded:/ })).toHaveCount(0);

    // ---- Project manager is notified and sees what's missing
    const o = await signIn(browser, pm, false);
    await o.goto("/notifications");
    await expect(o.getByText("Missing from the trailer: Sika 200C (3.31 Gal Kit)")).toBeVisible();
    await o.goto(`/manage/projects/${job.id}/work-orders/${fwoId}`);
    await expect(o.getByText("Sika 200C (3.31 Gal Kit): Only 18 kits in the shop")).toBeVisible();

    // ---- A new revision adds ESD Pigment; the crew lead brings the checklist up to date
    await publishAsOffice(pm, job.id, trailer([{ item: "ESD Pigment", qty: "19 + Partial" }]), { fwoId, changeSummary: "Add pigment" });
    await l.goto(`/jobs/${job.id}/checklist/${fwoId}`);
    await expect(l.getByText("The work order was updated (revision 1 → 2).")).toBeVisible();
    await l.getByRole("button", { name: "Update checklist" }).click();
    await expect(l.getByText("ESD Pigment")).toBeVisible();
    await expect(l.getByText("1 of 5 loaded")).toBeVisible(); // earlier ticks kept
  } finally {
    await deleteTestProject(job.id);
  }
});
