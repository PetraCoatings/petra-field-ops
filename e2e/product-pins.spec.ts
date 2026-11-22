import { randomBytes } from "node:crypto";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { onePagePdf } from "./support/one-page-pdf";
import { readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { addDocumentVersion, addLibraryItem, createTestProject, deleteTestProject, productLibraryExists } from "./support/test-project";

/**
 * Products in work orders and calculators:
 * - the office adds an approved product to a work order; its TDS and SDS
 *   versions are pinned and its mix ratio filled in;
 * - a newer TDS uploaded after publishing doesn't change the published work
 *   order (the crew still opens the pinned version) and the editor offers it;
 * - the calculators fill in the product's numbers, and Dew Point uses the
 *   product's own margin instead of the company's.
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

test("work orders pin data sheet versions; calculators fill from products", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one run covers office and phone");
  test.skip(!(await productLibraryExists()), "product library migration not applied");
  test.setTimeout(150_000);
  const users = readRoleUsers();
  const admin = users.find((x) => x.role === "office_admin")!;
  const pm = users.find((x) => x.role === "project_manager")!;
  const installer = users.find((x) => x.role === "installer")!;
  const name = `E2E ${randomBytes(3).toString("hex")} Epoxy 100`;
  const added = await addLibraryItem(admin, {
    kind: "product",
    name,
    approved: true,
    specs: {
      category: "basecoat",
      mix_ratio_a: 2,
      mix_ratio_b: 1,
      ratio_basis: "volume",
      kit_size_gal: 3,
      recommended_coverage_sqft_per_gal: 160,
      volume_solids_pct: 100,
      recommended_wft_mils: 10,
      min_substrate_above_dew_point_f: 8,
    },
    tds: onePagePdf("TDS version 1"),
    sds: onePagePdf("SDS version 1"),
  });
  const job = await createTestProject([installer]);
  try {
    // ---- Office: add the product to a work order and publish
    const office = await signIn(browser, pm, false);
    await office.goto(`/manage/projects/${job.id}`);
    await office.getByLabel("New work order").fill("Epoxy floor");
    await office.getByRole("button", { name: "Create" }).click();
    const products = office.getByRole("region", { name: "Products and data sheets" });
    await products.getByLabel("Add a product").selectOption({ label: name });
    await products.getByRole("button", { name: "Add", exact: true }).click();
    await expect(products.getByText("TDS pinned")).toBeVisible();
    await expect(products.getByText("SDS pinned")).toBeVisible();
    const mix = office.getByRole("region", { name: "Mix ratios" });
    await expect(mix.getByLabel("Product")).toHaveValue(name);
    await expect(mix.getByLabel("Ratio")).toHaveValue(/2.*1/);
    await office.getByRole("button", { name: "Save draft" }).click();
    await expect(office.getByText(/Draft saved at/)).toBeVisible();
    await office.getByRole("button", { name: "Publish revision 1" }).first().click();
    await expect(office.getByText("Revision 1 published. The crew has been notified.")).toBeVisible();

    // ---- A newer TDS is uploaded: the editor offers it, the published work order keeps version 1
    const newTds = await addDocumentVersion(admin, added.tds!, onePagePdf("TDS version 2"));
    await office.reload();
    await expect(office.getByRole("region", { name: "Products and data sheets" }).getByText("A newer data sheet was uploaded.")).toBeVisible();

    const phone = await signIn(browser, installer, true);
    await phone.goto(`/jobs/${job.id}`);
    const tds = phone.getByRole("link", { name: "TDS" }).first();
    await expect(tds).toHaveAttribute("href", new RegExp(`v=${added.tds}`));
    await expect(tds).not.toHaveAttribute("href", new RegExp(newTds));
    await phone.getByRole("link", { name: "SDS" }).first().click();
    await expect(phone.getByRole("heading", { name: `${name} SDS`, level: 1 })).toBeVisible();
    await expect(phone.getByRole("img", { name: "Page 1 of 1" })).toBeVisible();
    await phone.getByRole("link", { name: "Back" }).click();
    await expect(phone).toHaveURL(new RegExp(`/jobs/${job.id}`));

    // ---- Calculators fill from the product
    await phone.goto("/calculators/mix-ratio");
    await phone.getByLabel("Fill from a product (optional)").selectOption({ label: name });
    await expect(phone.locator("#mr-a")).toHaveValue("2");
    await expect(phone.locator("#mr-b")).toHaveValue("1");

    await phone.goto("/calculators/material-quantity");
    await phone.getByLabel("Fill from a product (optional)").selectOption({ label: name });
    await expect(phone.locator("#mq-coverage")).toHaveValue("160");
    await expect(phone.locator("#mq-kit")).toHaveValue("3");

    // Dew point: 70 °F air, 50% RH → dew point 50.5 °F. Surface 57 °F is 6.5° above:
    // fine with the company's 5° but not with this product's 8°.
    await phone.goto("/calculators/dew-point");
    await phone.getByLabel("Air temperature").fill("70");
    await phone.getByLabel("Relative humidity").fill("50");
    await phone.getByLabel("Surface (substrate) temperature").fill("57");
    await phone.getByLabel("Fill from a product (optional)").selectOption({ label: name });
    await expect(phone.getByText(`from the ${name} data sheet`)).toBeVisible();
    await expect(phone.getByText("Do not coat")).toBeVisible();
    await phone.getByLabel("Fill from a product (optional)").selectOption({ label: "No product: type the numbers" });
    await expect(phone.getByText("Do not coat")).toHaveCount(0);
  } finally {
    await deleteTestProject(job.id);
  }
});
