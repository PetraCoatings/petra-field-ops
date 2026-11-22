import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { archiveTestLibrary, productLibraryExists } from "./support/test-project";

/**
 * Product and SDS library (office side): create a product, enter specs, upload
 * a TDS twice (versions kept), approval rules, several SDS at once; an
 * installer with no job can open an SDS.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

async function signIn(browser: Browser, u: RoleUser): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

const pdf = (label: string) => ({
  name: `${label}.pdf`,
  mimeType: "application/pdf",
  buffer: Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`),
});

test("office manages products and data sheets; crews can open SDS", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one desktop run covers the library");
  test.skip(!(await productLibraryExists()), "apply supabase/migrations/20261124000100_product_library.sql to the dev project first");
  test.setTimeout(150_000);
  const prefix = `E2E ${randomBytes(3).toString("hex")}`;
  const users = readRoleUsers();
  const pm = users.find((x) => x.role === "project_manager")!;
  const admin = users.find((x) => x.role === "office_admin")!;
  const installer = users.find((x) => x.role === "installer")!;
  try {
    // ---- Project manager adds a product with specs and a TDS
    const p = await signIn(browser, pm);
    await p.goto("/manage");
    await p.getByRole("link", { name: "Products & SDS" }).click();
    await p.getByLabel("New product").fill(`${prefix} Sikafloor 264`);
    await p.getByLabel("Manufacturer").fill("Sika");
    await p.getByRole("button", { name: "Create" }).click();
    await expect(p.getByRole("heading", { name: `${prefix} Sikafloor 264`, level: 1 })).toBeVisible();
    await expect(p.getByText("Draft: not approved")).toBeVisible();
    await expect(p.getByRole("button", { name: "Approve specs" })).toHaveCount(0); // PMs can't approve
    await p.getByLabel("Mix ratio, Part A").fill("2");
    await p.getByLabel("Mix ratio, Part B").fill("1");
    await p.getByLabel("Ratio is by").selectOption("volume");
    await p.getByLabel("Volume solids").fill("100");
    await p.getByLabel("Kit size").fill("4.5");
    await p.getByLabel("Volume solids").fill("120");
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await expect(p.getByText("That number doesn't look right for this field.")).toBeVisible();
    await p.getByLabel("Volume solids").fill("100");
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await expect(p.getByText("Saved.", { exact: true })).toBeVisible();

    const tds = p.getByRole("region", { name: "Technical data sheet (TDS)" });
    await tds.locator('input[type="file"]').setInputFiles(pdf("Sikafloor-264-TDS-2025"));
    await expect(tds.getByText("1 file uploaded.")).toBeVisible();
    await expect(tds.getByRole("link", { name: /Sikafloor-264-TDS-2025\.pdf/ })).toBeVisible();
    await tds.getByLabel("Revision date on the sheet (optional)").fill("2026-06-01");
    await tds.locator('input[type="file"]').setInputFiles(pdf("Sikafloor-264-TDS-2026"));
    await expect(tds.getByRole("link", { name: /Sikafloor-264-TDS-2026\.pdf/ })).toBeVisible();
    await expect(tds).toContainText("Version 2");
    await expect(tds).toContainText("1 older version");

    // ---- Office admin approves
    const a = await signIn(browser, admin);
    await a.goto(p.url().replace(/^https?:\/\/[^/]+/, ""));
    await a.getByRole("button", { name: "Approve specs" }).click();
    await expect(a.getByText(/Approved by .+\. Crews can see this product\./)).toBeVisible();

    // ---- A spec change by the project manager sends it back to draft
    await p.reload();
    await expect(p.getByText("Approved", { exact: true })).toBeVisible();
    await p.getByLabel("Volume solids").fill("99");
    await p.getByRole("button", { name: "Save", exact: true }).click();
    await expect(p.getByText("Because a spec changed, the product went back to draft")).toBeVisible();

    // ---- Several standalone SDS at once
    await p.goto("/manage/library/sds");
    await p.locator('input[type="file"]').first().setInputFiles([pdf(`${prefix}_Acetone_SDS`), pdf(`${prefix}_Xylene_SDS`)]);
    await expect(p.getByText("2 files uploaded.")).toBeVisible();
    await expect(p.getByText(`${prefix} Acetone SDS`)).toBeVisible();
    await expect(p.getByText(`${prefix} Xylene SDS`)).toBeVisible();
    const sdsHref = await p.getByRole("link", { name: `${prefix}_Acetone_SDS.pdf` }).getAttribute("href");
    expect(sdsHref).toMatch(/^\/documents\/[0-9a-f-]{36}$/);

    // ---- An installer on no particular job can open it
    const i = await signIn(browser, installer);
    const res = await i.request.get(sdsHref!);
    expect(res.status()).toBe(200);
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
  } finally {
    await archiveTestLibrary(prefix);
  }
});
