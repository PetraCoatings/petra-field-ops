import { randomBytes } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { onePagePdf } from "./support/one-page-pdf";
import { addLibraryItem, productLibraryExists } from "./support/test-project";

/**
 * Crews' Product Data Sheets and Safety Data Sheets on a phone: approved
 * products only, data sheets open inside the app (with a way back), and an SDS
 * saved on the phone opens with the network off. The installer is on no job.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("crews browse products and keep SDS on the phone for no-signal use", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run covers the field library");
  test.skip(!(await productLibraryExists()), "product library migration not applied");
  test.setTimeout(150_000);
  const prefix = `E2E ${randomBytes(3).toString("hex")}`;
  const users = readRoleUsers();
  const admin = users.find((x) => x.role === "office_admin")!;
  const installer = users.find((x) => x.role === "installer")!;
  await addLibraryItem(admin, {
    kind: "product",
    name: `${prefix} Sikafloor 264`,
    approved: true,
    specs: { category: "basecoat", mix_ratio_a: 2, mix_ratio_b: 1, ratio_basis: "volume", kit_size_gal: 4.5, pot_life_minutes: 25 },
    tds: onePagePdf("Sikafloor 264 TDS"),
    sds: onePagePdf("Sikafloor 264 SDS"),
  });
  await addLibraryItem(admin, { kind: "product", name: `${prefix} Unapproved Primer`, approved: false });
  await addLibraryItem(admin, { kind: "sds", name: `${prefix} Acetone`, pdf: onePagePdf("Acetone SDS") });

  const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(installer.email);
  await page.getByLabel("Password", { exact: true }).fill(installer.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);

  // ---- Product Data Sheets: approved products only, with key specs
  await page.getByRole("link", { name: "Product Data Sheets" }).click();
  await page.getByRole("searchbox").fill(prefix);
  await page.getByRole("button", { name: "Search products" }).click();
  const card = page.getByRole("listitem").filter({ hasText: `${prefix} Sikafloor 264` });
  await expect(card).toContainText("2A : 1B (volume)");
  await expect(card).toContainText("4.5 gal");
  await expect(card).toContainText("25 min");
  await expect(page.getByText(`${prefix} Unapproved Primer`)).toHaveCount(0);

  // ---- A data sheet opens inside the app, and Back returns to the list
  await card.getByRole("link", { name: "SDS" }).click();
  await expect(page.getByRole("heading", { name: `${prefix} Sikafloor 264 SDS`, level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: "Page 1 of 1" })).toBeVisible();
  await page.getByRole("link", { name: "Back" }).click();
  await expect(page).toHaveURL(/\/products\?q=/);

  // ---- Safety Data Sheets: search, open, save on this phone
  await page.goto("/sds");
  await page.getByRole("searchbox").fill(`${prefix} acetone`);
  await page.getByRole("link", { name: new RegExp(`${prefix} Acetone`) }).click();
  await expect(page.getByRole("img", { name: "Page 1 of 1" })).toBeVisible();
  await page.getByRole("button", { name: "Save on this phone" }).click();
  await expect(page.getByText("Saved on this phone: it opens with no signal.")).toBeVisible();

  // Let the app save its offline copy of the SDS list and viewer (as after any online visit).
  await page.goto("/calculators");
  await expect(page.getByText("Saved on this phone: the calculators work without signal.")).toBeVisible({ timeout: 30_000 });

  // ---- No signal: the saved SDS still opens
  await context.setOffline(true);
  await page.goto("/sds");
  await expect(page.getByRole("heading", { name: "Saved on this phone (1)" })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(`${prefix} Acetone`) }).first().click();
  await expect(page.getByText("No signal: showing the copy saved on this phone.")).toBeVisible();
  await expect(page.getByRole("img", { name: "Page 1 of 1" })).toBeVisible();
  await context.setOffline(false);
  await context.close();
});
