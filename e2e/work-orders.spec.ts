import { expect, test, devices, type Browser, type Page } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { addTestContact, createTestProject, deleteTestProject, workOrdersTableExists } from "./support/test-project";

/**
 * Field work orders end to end: the office writes and publishes a work order
 * with a drawing; the installer is notified, reads it on a phone and confirms;
 * the office sees the confirmation and publishes revision 2 with a change note;
 * the installer is asked to confirm again. Needs the dev Supabase project with
 * the work orders migration applied; skipped otherwise.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

// 1×1 PNG, standing in for a floor plan.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

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

test("office publishes a work order; the installer reads and confirms it on a phone", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one run covers both screens (and limits sign-ins)");
  test.skip(!(await workOrdersTableExists()), "apply supabase/migrations/20261121000200_field_work_orders.sql to the dev project first");
  test.setTimeout(120_000);

  const users = readRoleUsers();
  const pm = users.find((x) => x.role === "project_manager")!;
  const installer = users.find((x) => x.role === "installer")!;
  const job = await createTestProject([installer]);
  await addTestContact(job.id, { name: "John Janacek", title: "with CRC", phone: "(512) 555-0816" });
  try {
    // ---- Office writes and publishes revision 1
    const office = await signIn(browser, pm, false);
    await office.goto(`/manage/projects/${job.id}`);
    await office.getByLabel("New work order").fill("Conductive system");
    await office.getByRole("button", { name: "Create" }).click();
    await expect(office.getByRole("heading", { name: "Work order 1 · Conductive system" })).toBeVisible();

    const summary = office.getByRole("region", { name: "Job summary" });
    await summary.getByLabel("Value").first().fill("6,620 sf Sika 200C Conductive System");
    const trailer = office.getByRole("region", { name: "Materials to bring in trailer" });
    await trailer.getByRole("button", { name: "Add item" }).click();
    await trailer.getByLabel("Item").fill("Sika 200C (3.31 Gal Kit)");
    await trailer.getByLabel("Quantity").fill("19 Kits + Partial");
    const mix = office.getByRole("region", { name: "Mix ratios" });
    await mix.getByRole("button", { name: "Add mix ratio" }).click();
    await mix.getByLabel("Product").fill("Sikafloor 200C");
    await mix.getByLabel("Ratio").fill("2.18A : 1B : .15C : .3Pig");
    const schedule = office.getByRole("region", { name: "Schedule" });
    await schedule.getByRole("button", { name: "Add step" }).click();
    await schedule.getByLabel("Step 1", { exact: true }).fill("Load up and drive to jobsite, arrive by 10am.");
    await schedule.getByRole("button", { name: "Add step" }).click();
    await schedule.getByLabel("Step 2", { exact: true }).fill("Sand floor extremely well, no glossy spots.");
    await schedule.getByRole("checkbox", { name: "Important" }).nth(1).check();
    await office.locator("#wo-files").setInputFiles({ name: "floor-plan.png", mimeType: "image/png", buffer: PNG });
    await expect(office.getByRole("region", { name: "Drawings and photos" }).getByText("floor-plan.png")).toBeVisible();

    await office.getByRole("button", { name: "Save draft" }).click();
    await expect(office.getByText(/Draft saved at/)).toBeVisible();
    await office.getByRole("button", { name: "Publish revision 1" }).first().click();
    await expect(office.getByText("Revision 1 published. The crew has been notified.")).toBeVisible();

    // ---- Installer: notification → work order → confirm
    const phone = await signIn(browser, installer, true);
    await expect(phone.getByRole("link", { name: "1 new notification" })).toBeVisible();
    await phone.getByRole("link", { name: "1 new notification" }).click();
    await phone.getByRole("button", { name: /New work order 1/ }).click();
    await expect(phone.getByRole("heading", { name: "New work order" })).toBeVisible();
    await expect(phone.getByText("John Janacek")).toBeVisible();
    await expect(phone.getByRole("link", { name: "(512) 555-0816" })).toHaveAttribute("href", "tel:5125550816");
    await expect(phone.getByText("6,620 sf Sika 200C Conductive System")).toBeVisible();
    await expect(phone.getByText("19 Kits + Partial")).toBeVisible();
    await expect(phone.getByText("2.18A : 1B : .15C : .3Pig")).toBeVisible();
    await expect(phone.getByText("Important: Sand floor extremely well")).toHaveCount(0); // sr-only prefix is separate text
    await expect(phone.locator("li", { hasText: "Sand floor extremely well" })).toHaveClass(/bg-red-50/);
    await expect(phone.getByRole("img", { name: "floor-plan.png" })).toBeVisible();
    await phone.getByRole("button", { name: "I've read revision 1" }).click();
    await expect(phone.getByText(/You confirmed revision 1 on/)).toBeVisible();
    await expect(phone.getByRole("link", { name: "Notifications" })).toBeVisible(); // bell no longer shows a count

    // ---- Office sees the confirmation, then publishes revision 2
    await office.reload();
    const acks = office.locator("section", { hasText: "Who has read revision 1" });
    await expect(acks).toContainText(installer.firstName);
    await expect(acks).not.toContainText("Not yet");
    await office.getByRole("region", { name: "Schedule" }).getByLabel("Step 2", { exact: true }).fill("Sand floor extremely well, then solvent wipe.");
    await office.getByRole("button", { name: "Publish revision 2" }).first().click();
    await expect(office.getByText("Describe what changed before publishing a new revision.")).toBeVisible();
    await office.getByLabel("What changed? (required)").fill("Added solvent wipe after sanding");
    await office.getByRole("button", { name: "Publish revision 2" }).first().click();
    await expect(office.getByText("Revision 2 published. The crew has been notified.")).toBeVisible();

    // ---- Installer is asked to confirm the new revision
    await phone.goto(`/jobs/${job.id}`);
    await expect(phone.getByText("New: read it and tap \"I've read this\"")).toBeVisible();
    await phone.getByRole("link", { name: /Work order 1 · Conductive system/ }).click();
    await expect(phone.getByRole("heading", { name: "Updated work order: revision 2" })).toBeVisible();
    await expect(phone.getByText("Added solvent wipe after sanding")).toBeVisible();
    // Revision 1 is still exactly as published.
    await phone.getByRole("link", { name: "Revision 1" }).click();
    await expect(phone.getByText("You're looking at revision 1. The current one is revision 2.")).toBeVisible();
    await expect(phone.getByText("Sand floor extremely well, no glossy spots.")).toBeVisible();
  } finally {
    await deleteTestProject(job.id);
  }
});
