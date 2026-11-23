import { randomBytes } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { signInAs } from "./support/sign-in";

/**
 * When the invitation email doesn't arrive, the office makes a one-time
 * sign-up link to text instead. (The link isn't opened here: it would sign
 * in as the new person.)
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("the office gets a sign-up link for someone who hasn't signed in", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one desktop run");
  const admin = readRoleUsers().find((x) => x.role === "office_admin")!;
  const email = `e2e-invitee-${randomBytes(4).toString("hex")}@example.com`;
  const created = await api("/rest/v1/employees", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ first_name: "E2E", last_name: "Invitee", email, role: "installer" }),
  });
  expect(created.ok).toBe(true);
  const [{ id }] = (await created.json()) as { id: string }[];
  const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: test.info().project.use.baseURL, permissions: ["clipboard-read", "clipboard-write"] });
  try {
    const page = await context.newPage();
    await signInAs(page, admin);
    await expect(page).toHaveURL(/\/$/);

    await page.goto(`/manage/employees/${id}`);
    await expect(page.getByText("Not invited yet")).toBeVisible();
    await page.getByRole("button", { name: "Get a sign-in link to text" }).click();
    const box = page.getByLabel("Send this link to E2E by text:");
    await expect(box).toHaveValue(/\/auth\/start\?token_hash=\w+&type=invite&next=%2Fset-password$/);
    const first = await box.inputValue();
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

    // A messaging app opens the link to build a preview: that must not use it up.
    const preview = await context.request.get(first);
    expect(preview.ok()).toBe(true);

    // The new person taps it, taps Continue, and is asked to choose a password.
    const phone = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
    try {
      const p = await phone.newPage();
      await p.goto(first);
      await expect(p.getByRole("heading", { name: "Welcome to Petra Field Ops" })).toBeVisible();
      await p.getByRole("button", { name: "Continue" }).click();
      await expect(p).toHaveURL(/\/set-password$/);
      // The same link can't be used twice.
      await p.context().clearCookies();
      await p.goto(first);
      await p.getByRole("button", { name: "Continue" }).click();
      await expect(p.getByText("That link has expired or was already used.")).toBeVisible();
    } finally {
      await phone.close();
    }

    // Signed in once: the office can still text a sign-in link (forgot password, email didn't arrive).
    await page.reload();
    await expect(page.getByText("Account set up")).toBeVisible();
    await page.getByRole("button", { name: "Get a sign-in link to text" }).click();
    await expect(page.getByLabel("Send this link to E2E by text:")).toHaveValue(/type=magiclink/);
  } finally {
    await context.close();
    const emp = (await (await api(`/rest/v1/employees?select=user_id&id=eq.${id}`)).json()) as { user_id: string | null }[];
    await api(`/rest/v1/employees?id=eq.${id}`, { method: "DELETE" });
    if (emp[0]?.user_id) await api(`/auth/v1/admin/users/${emp[0].user_id}`, { method: "DELETE" });
  }
});

test("the password-reset email's link survives an email scanner opening it, and leads to a new password", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run is enough");
  // The link the "Reset password" template builds (supabase/templates/recovery.html).
  const installer = readRoleUsers().find((x) => x.role === "installer")!;
  const res = await api("/auth/v1/admin/generate_link", { method: "POST", body: JSON.stringify({ type: "recovery", email: installer.email }) });
  expect(res.ok).toBe(true);
  const { hashed_token } = (await res.json()) as { hashed_token: string };
  const link = `/auth/start?token_hash=${hashed_token}&type=recovery&next=/set-password`;
  const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  try {
    // A scanner (Outlook Safe Links, Gmail) fetching the link first doesn't use it up.
    expect((await c.request.get(link)).ok()).toBe(true);
    const p = await c.newPage();
    await p.goto(link);
    await p.getByRole("button", { name: "Continue" }).click();
    await expect(p).toHaveURL(/\/set-password$/);
    await expect(p.getByLabel("New password")).toBeVisible();
  } finally {
    await c.close();
  }
});
