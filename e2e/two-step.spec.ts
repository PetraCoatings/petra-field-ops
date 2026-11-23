import { randomBytes } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { signInAs } from "./support/sign-in";
import { passwordToken, totp, twoStepToken } from "./support/totp";

/**
 * Two-step sign-in for office admins (migration 20261130000100): code after
 * the password, first-time setup with an authenticator app, a password alone
 * gives no admin powers, and an admin can reset someone's lost authenticator.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");
test.describe.configure({ mode: "serial" });
test.beforeEach(() => test.skip(test.info().project.name !== "phone", "one phone run is enough"));

const admin = () => readRoleUsers().find((x) => x.role === "office_admin")!;

test("an office admin types an authenticator code after the password; a wrong code is refused", async ({ browser }) => {
  const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  try {
    const page = await c.newPage();
    const u = admin();
    await page.goto("/login");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/two-step$/);
    await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
    // Before the code, the office pages send them back here.
    await page.goto("/manage/employees");
    await expect(page).toHaveURL(/\/two-step$/);
    const right = totp(u.totpSecret!);
    await page.getByLabel("6-digit code").fill(right === "123456" ? "654321" : "123456");
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "That code didn't work" })).toBeVisible();
    await page.getByLabel("6-digit code").fill(totp(u.totpSecret!));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/manage/employees");
    await expect(page.getByRole("heading", { name: "Employees", level: 1 })).toBeVisible();
  } finally {
    await c.close();
  }
});

test("a password alone gives an office admin no admin powers in the database", async () => {
  const u = admin();
  const read = async (token: string) =>
    (await (
      await fetch(`${process.env.E2E_SUPABASE_URL}/rest/v1/employees?select=id`, { headers: { apikey: process.env.E2E_SUPABASE_KEY!, Authorization: `Bearer ${token}` } })
    ).json()) as unknown[];
  expect(await read(await passwordToken(u.email, u.password))).toHaveLength(1); // only themselves
  expect((await read(await twoStepToken(u.email, u.password, u.totpSecret!))).length).toBeGreaterThan(1);
});

test("a new office admin sets up the authenticator on first sign-in; another admin can reset it", async ({ browser }) => {
  // A second, brand-new office admin with no authenticator yet.
  const email = `e2e-new-admin-${randomBytes(4).toString("hex")}@example.test`;
  const password = `${randomBytes(12).toString("base64url")}9a`;
  const created = await api("/auth/v1/admin/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
  expect(created.ok).toBe(true);
  const { id: userId } = (await created.json()) as { id: string };
  const extra: RoleUser = { role: "office_admin", email, password, userId, firstName: "E2E Newadmin" };
  const contexts: { close: () => Promise<void> }[] = [];
  try {
    const emp = await api("/rest/v1/employees", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ user_id: userId, first_name: "E2E Newadmin", last_name: "Test", email, role: "office_admin" }),
    });
    expect(emp.ok).toBe(true);
    const [{ id: employeeId }] = (await emp.json()) as { id: string }[];

    const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
    contexts.push(c);
    const page = await c.newPage();
    await signInAs(page, extra);
    await expect(page).toHaveURL(/\/two-step$/);
    await expect(page.getByRole("heading", { name: "Set up two-step sign-in" })).toBeVisible();
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(page.getByRole("img", { name: /QR code/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open in my authenticator app/ })).toHaveAttribute("href", /^otpauth:\/\/totp\//);
    await page.getByText("Can't scan? Type this key instead").click();
    const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
    await page.getByLabel("6-digit code").fill(totp(secret));
    await page.getByRole("button", { name: "Confirm" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/manage/employees");
    await expect(page.getByRole("heading", { name: "Employees", level: 1 })).toBeVisible();

    // The test office admin resets it (as for a lost phone).
    const o = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
    contexts.push(o);
    const office = await o.newPage();
    await signInAs(office, admin());
    await expect(office).toHaveURL(/\/$/);
    await office.goto(`/manage/employees/${employeeId}`);
    await expect(office.getByText("Two-step sign-in: on (authenticator app).")).toBeVisible();
    await office.getByRole("button", { name: "Reset two-step sign-in" }).click();
    await expect(office.getByText("Two-step sign-in was reset.")).toBeVisible();
    const user = (await (await api(`/auth/v1/admin/users/${userId}`)).json()) as { factors?: unknown[] };
    expect(user.factors ?? []).toHaveLength(0);
  } finally {
    for (const c of contexts) await c.close();
    await api(`/rest/v1/employees?user_id=eq.${userId}`, { method: "DELETE" });
    await api(`/auth/v1/admin/users/${userId}`, { method: "DELETE" });
  }
});
