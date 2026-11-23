import { expect, test } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { signInAs } from "./support/sign-in";

/**
 * Airplane mode: after one online visit, every calculator opens and works with
 * the network off, other pages show "No connection", and signing out removes
 * the saved copies. Needs a signed-in user (dev Supabase project).
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("calculators work in airplane mode and sign-out clears them", async ({ page, context }) => {
  test.skip(test.info().project.name !== "phone", "one phone run covers offline (and limits sign-ins)");
  const u = readRoleUsers().find((x) => x.role === "crew_lead")!;
  await signInAs(page, u);
  await expect(page).toHaveURL(/\/$/);

  // One online visit to the app saves all five calculators, even unopened ones.
  await page.goto("/calculators");
  await expect(page.getByText("Saved on this phone: the calculators work without signal.")).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);

  // A calculator never opened before loads and calculates with no network.
  await page.goto("/calculators/mix-ratio");
  await expect(page.getByRole("heading", { name: "Mix Ratio", level: 1 })).toBeVisible();
  await page.getByLabel("Part A", { exact: true }).fill("2");
  await page.getByLabel("Part B", { exact: true }).fill("1");
  await page.getByLabel("Batch size, gal").fill("3");
  await expect(page.getByRole("region", { name: "Mix by volume" })).toContainText("2 gal 0.0 fl oz");

  // In-app links between calculators work offline too.
  await page.getByRole("link", { name: "Calculators" }).click();
  await expect(page.getByRole("heading", { name: "Calculators", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: /Dew Point/ }).click();
  await expect(page.getByRole("heading", { name: "Dew Point", level: 1 })).toBeVisible();
  await page.getByLabel("Air temperature").fill("70");
  await page.getByLabel("Relative humidity").fill("50");
  await expect(page.getByText("50.5 °F", { exact: true })).toBeVisible();

  // Pages that need live data say so, and point back to the calculators.
  await page.goto("/jobs");
  await expect(page.getByRole("heading", { name: "No connection" })).toBeVisible();
  await page.getByRole("link", { name: "Open Calculators" }).click();
  await expect(page.getByRole("heading", { name: "Calculators", level: 1 })).toBeVisible();

  // Back online: signing out wipes the saved pages and remembered entries.
  await context.setOffline(false);
  await page.goto("/");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect
    .poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("petra-offline-")).length))
    .toBe(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("petra.calc.")))).toEqual([]);

  await context.setOffline(true);
  await page.goto("/calculators");
  await expect(page.getByRole("heading", { name: "No connection" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Calculators", level: 1 })).toHaveCount(0);
  await context.setOffline(false);
});
