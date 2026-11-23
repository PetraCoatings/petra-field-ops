import { expect, test } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { createTestProject, deleteTestProject, savedCalculationsTableExists } from "./support/test-project";
import { signInAs } from "./support/sign-in";

/**
 * "Save to job": an installer saves a dew point reading to their job, sees it
 * on the job page, and deletes it. Needs the dev Supabase project with the
 * saved_calculations migration applied; skipped otherwise.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("an installer saves a calculator result to their job", async ({ page, context }) => {
  test.skip(test.info().project.name !== "phone", "one phone run covers saving (and limits sign-ins)");
  test.skip(!(await savedCalculationsTableExists()), "apply supabase/migrations/20261121000100_saved_calculations.sql to the dev project first");

  const u = readRoleUsers().find((x) => x.role === "installer")!;
  const job = await createTestProject([u]);
  try {
    await signInAs(page, u);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/calculators/dew-point");
    const saveButton = page.getByRole("button", { name: "Save to job…" });
    await expect(saveButton).toBeDisabled(); // nothing to save yet
    await page.getByLabel("Air temperature").fill("70");
    await page.getByLabel("Relative humidity").fill("50");
    await page.getByLabel("Surface (substrate) temperature").fill("60");

    // Without signal, saving explains itself and keeps the numbers.
    await context.setOffline(true);
    await saveButton.click();
    await expect(page.getByText("Saving needs a signal.")).toBeVisible();
    await context.setOffline(false);

    await saveButton.click();
    await page.getByLabel("Job", { exact: true }).selectOption({ label: job.name });
    await page.getByLabel("Note (optional)").fill("Bay 2 before primer");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(`Saved to ${job.name}.`)).toBeVisible();

    await page.getByRole("link", { name: "Open job" }).click();
    await expect(page.getByRole("heading", { name: job.name, level: 1 })).toBeVisible();
    const saved = page.getByRole("region", { name: "Saved calculations" }).or(page.locator("section", { hasText: "Saved calculations" }));
    await expect(saved).toContainText("Bay 2 before primer");
    await expect(saved).toContainText("Dew point 50.5 °F");
    await expect(saved).toContainText("Surface 60.0 °F · OK to coat");
    await expect(saved).toContainText(u.firstName);

    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Delete: Dew Point" }).click();
    await expect(saved).toContainText("Nothing saved yet.");
  } finally {
    await deleteTestProject(job.id);
  }
});
