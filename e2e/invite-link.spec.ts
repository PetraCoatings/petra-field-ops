import { randomBytes } from "node:crypto";
import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";

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
    await page.goto("/login");
    await page.getByLabel("Email").fill(admin.email);
    await page.getByLabel("Password", { exact: true }).fill(admin.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.goto(`/manage/employees/${id}`);
    await expect(page.getByText("Not invited yet")).toBeVisible();
    await page.getByRole("button", { name: "Get a sign-up link to text" }).click();
    const box = page.getByLabel("Send this link to E2E by text:");
    // (Supabase only keeps the return address for approved sites, so a test run on another address sees the site's home page.)
    await expect(box).toHaveValue(/\/auth\/v1\/verify\?token=\w+&type=invite&redirect_to=/);
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();

    // Now linked to an account that has never signed in: both ways to reach them are offered.
    await page.reload();
    await expect(page.getByText(/hasn't signed in yet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send the invitation email again" })).toBeVisible();
    await page.getByRole("button", { name: "Get a sign-up link to text" }).click();
    await expect(page.getByLabel("Send this link to E2E by text:")).toHaveValue(/type=magiclink/);
  } finally {
    await context.close();
    const emp = (await (await api(`/rest/v1/employees?select=user_id&id=eq.${id}`)).json()) as { user_id: string | null }[];
    await api(`/rest/v1/employees?id=eq.${id}`, { method: "DELETE" });
    if (emp[0]?.user_id) await api(`/auth/v1/admin/users/${emp[0].user_id}`, { method: "DELETE" });
  }
});
