import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { createTestProject, deleteTestProject, deleteTestTemplates, templatesTableExists } from "./support/test-project";
import { signInAs } from "./support/sign-in";

/**
 * Work order templates: create one, insert it into a work order, change the
 * job's copy (the template stays as it was), and save a work order as a new
 * template (dates are left out). Nothing is published, so the test job is
 * deleted afterwards. Needs the templates migration on the dev project.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("templates are copied into work orders and never change them afterwards", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "one desktop run covers templates");
  test.skip(!(await templatesTableExists()), "apply supabase/migrations/20261122000100_work_order_templates.sql to the dev project first");
  test.setTimeout(120_000);

  const prefix = `E2E ${randomBytes(3).toString("hex")}`;
  const pm = readRoleUsers().find((x) => x.role === "project_manager")!;
  const job = await createTestProject([]);
  try {
    await signInAs(page, pm);
    await expect(page).toHaveURL(/\/$/);

    // ---- Create a template
    await page.goto("/manage");
    await page.getByRole("link", { name: "Templates" }).click();
    await expect(page.getByRole("heading", { name: "Work order templates", level: 1 })).toBeVisible();
    await page.getByLabel("New template").fill(`${prefix} Sika 200C conductive`);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("heading", { name: `${prefix} Sika 200C conductive`, level: 1 })).toBeVisible();
    const mix = page.getByRole("region", { name: "Mix ratios" });
    await mix.getByRole("button", { name: "Add mix ratio" }).click();
    await mix.getByRole("textbox", { name: "Product", exact: true }).fill("Sikafloor 200C");
    await mix.getByRole("textbox", { name: "Ratio", exact: true }).fill("2.18A : 1B : .15C : .3Pig");
    const sch = page.getByRole("region", { name: "Schedule" });
    await sch.getByRole("button", { name: "Add day" }).click();
    await sch.getByRole("textbox", { name: "Day", exact: true }).fill("Coat day");
    await sch.getByRole("button", { name: "Add step" }).click();
    await sch.getByRole("textbox", { name: "Step 1", exact: true }).fill("Apply 200C at 16 mils");
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText("Template saved.")).toBeVisible();

    // A duplicate name is refused (ignoring case).
    await page.goto("/manage/templates");
    await page.getByLabel("New template").fill(`${prefix} SIKA 200C conductive`);
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("A template with this name already exists.")).toBeVisible();

    // ---- Insert it into a new work order and change the job's copy
    await page.goto(`/manage/projects/${job.id}`);
    await page.getByLabel("New work order").fill("Conductive floor");
    await page.getByRole("button", { name: "Create" }).click();
    await page.getByLabel("Insert a template").selectOption({ label: `${prefix} Sika 200C conductive` });
    await expect(page.getByText(/1 day, 1 step, 0 materials, 1 mix ratio/)).toBeVisible();
    await page.getByRole("button", { name: "Insert", exact: true }).click();
    await expect(page.getByText(`Added "${prefix} Sika 200C conductive".`)).toBeVisible();
    const woSchedule = page.getByRole("region", { name: "Schedule" });
    await expect(woSchedule.getByRole("textbox", { name: "Day", exact: true })).toHaveValue("Coat day"); // empty Day 1 replaced
    await expect(page.getByRole("region", { name: "Mix ratios" }).getByRole("textbox", { name: "Ratio", exact: true })).toHaveValue("2.18A : 1B : .15C : .3Pig");
    await woSchedule.getByRole("textbox", { name: "Step 1", exact: true }).fill("Apply 200C at 18 mils on this job");
    await woSchedule.getByLabel("Date", { exact: true }).fill("2027-01-11");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Draft saved at/)).toBeVisible();

    // ---- Save the work order as a new template
    await page.getByRole("button", { name: "Save this work order as a template" }).click();
    await page.getByLabel("Template name", { exact: true }).fill(`${prefix} Conductive, thick`);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByText(`Saved as template "${prefix} Conductive, thick".`)).toBeVisible();

    // ---- The original template is unchanged by the job's edit
    await page.goto("/manage/templates");
    await page.getByRole("link", { name: new RegExp(`${prefix} Sika 200C conductive`) }).click();
    await expect(page.getByRole("region", { name: "Schedule" }).getByRole("textbox", { name: "Step 1", exact: true })).toHaveValue("Apply 200C at 16 mils");

    // ---- The new template has the job's version, without the date
    await page.goto("/manage/templates");
    await page.getByRole("link", { name: new RegExp(`${prefix} Conductive, thick`) }).click();
    const tplSchedule = page.getByRole("region", { name: "Schedule" });
    await expect(tplSchedule.getByRole("textbox", { name: "Step 1", exact: true })).toHaveValue("Apply 200C at 18 mils on this job");
    await expect(tplSchedule.getByLabel("Date", { exact: true })).toHaveValue("");

    // ---- Archive hides it from the work order's list; delete removes it
    await page.getByRole("button", { name: "Archive" }).click();
    await expect(page.getByText("This template is archived.")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/\/manage\/templates$/);
    await expect(page.getByRole("link", { name: new RegExp(`${prefix} Conductive, thick`) })).toHaveCount(0);
  } finally {
    await deleteTestTemplates(prefix);
    await deleteTestProject(job.id);
  }
});
