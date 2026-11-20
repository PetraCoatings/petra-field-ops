import { expect, test } from "@playwright/test";

test.describe("signed-out visitors", () => {
  for (const path of ["/", "/jobs", "/time-clock", "/manage", "/manage/employees", "/jobs/20000000-0000-4000-8000-000000000001"]) {
    test(`are sent to sign in from ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    });
  }
});

test("sign-in page has labelled fields and large touch targets", async ({ page }) => {
  await page.goto("/login");
  const email = page.getByLabel("Email");
  const password = page.getByLabel("Password", { exact: true });
  await expect(email).toBeVisible();
  await expect(password).toHaveAttribute("type", "password");
  await page.getByLabel("Show password").check();
  await expect(password).toHaveAttribute("type", "text");
  const button = page.getByRole("button", { name: "Sign in" });
  const box = await button.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});

test("a failed sign-in shows a clear error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("someone@example.test");
  await page.getByLabel("Password", { exact: true }).fill("wrong-password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

test("switching to Spanish translates the page and is remembered", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Español" }).click();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await page.getByRole("button", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("a Spanish-language phone gets Spanish by default", async ({ browser }) => {
  const context = await browser.newContext({ locale: "es-MX" });
  const page = await context.newPage();
  await page.goto(`${test.info().project.use.baseURL}/login`);
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await context.close();
});

test("forgot-password form validates the email", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot your password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText("Enter a valid email address.")).toBeVisible();
});

test("invalid email links are rejected safely", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=bogus&type=recovery&next=https://evil.example");
  await expect(page).toHaveURL(/\/login\?reason=link-invalid$/);
  await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
});

test("no horizontal scrolling on the sign-in page", async ({ page }) => {
  await page.goto("/login");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("the app is installable: manifest and icons are served", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.name).toBe("Petra Field Operations");
  expect(manifest.display).toBe("standalone");
  for (const icon of manifest.icons) {
    const img = await request.get(icon.src);
    expect(img.ok(), icon.src).toBe(true);
    expect(img.headers()["content-type"]).toContain("image/png");
  }
});

test("security headers are set", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-powered-by"]).toBeUndefined();
});

test("an expired default invitation link shows a clear message", async ({ page }) => {
  await page.goto("/auth/accept?next=/set-password#error=access_denied&error_code=otp_expired");
  await expect(page.getByRole("alert").filter({ hasText: "expired" })).toBeVisible();
  // Tokens/errors are removed from the address bar.
  expect(new URL(page.url()).hash).toBe("");
});

test("a bad password-reset code is rejected safely", async ({ page }) => {
  await page.goto("/auth/confirm?code=bogus&next=/set-password");
  await expect(page).toHaveURL(/\/login\?reason=link-invalid$/);
});
