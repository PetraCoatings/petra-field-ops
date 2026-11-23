import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { employeeId } from "./support/test-project";

/**
 * Pay rates: the office adds a person's Job/Drive/Ride rates; the person sees
 * only their own, after re-entering their password, and they hide again.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("office sets pay rates; the installer sees their own after entering their password", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.skip((await api("/rest/v1/pay_rates?select=id&limit=1")).status === 404, "apply supabase/migrations/20261126000100_pay_rates.sql first");
  test.setTimeout(90_000);
  const users = readRoleUsers();
  const admin = users.find((x) => x.role === "office_admin")!;
  const installer = users.find((x) => x.role === "installer")!;
  const emp = await employeeId(installer);
  const signIn = async (u: typeof admin, phone: boolean) => {
    const c = await browser.newContext({ ...(phone ? devices["iPhone 13"] : devices["Desktop Chrome"]), baseURL: test.info().project.use.baseURL });
    const page = await c.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    return { c, page };
  };
  const office = await signIn(admin, false);
  const phone = await signIn(installer, true);
  try {
    await office.page.goto(`/manage/employees/${emp}`);
    const rows = office.page.getByRole("table").getByRole("row");
    for (const [i, [cat, rate]] of ([["job", "25"], ["drive", "18"], ["ride", "15.50"]] as const).entries()) {
      await office.page.getByLabel("Kind of time").selectOption(cat);
      await office.page.getByLabel("Hourly rate ($)").fill(rate);
      await office.page.getByLabel("Starts on").fill("2026-01-05");
      await office.page.getByRole("button", { name: "Add rate" }).click();
      await expect(rows).toHaveCount(i + 2); // header + one row per rate
    }
    await office.page.getByLabel("Hourly rate ($)").fill("abc");
    await office.page.getByRole("button", { name: "Add rate" }).click();
    await expect(office.page.getByText("Enter an hourly rate like 25 or 25.50.")).toBeVisible();
    const table = office.page.getByRole("table");
    await expect(table).toContainText("$25.00");
    await expect(table).toContainText("$15.50");

    // The installer: rates hidden until the password is re-entered
    await phone.page.goto("/time-clock/timesheet");
    await phone.page.getByRole("link", { name: "My pay rates" }).click();
    await expect(phone.page.getByText("$25.00")).toHaveCount(0);
    await phone.page.getByLabel("Your password").fill("not-my-password");
    await phone.page.getByRole("button", { name: "Show my pay rates" }).click();
    await expect(phone.page.getByText("That password isn't right.")).toBeVisible();
    await phone.page.getByLabel("Your password").fill(installer.password);
    await phone.page.getByRole("button", { name: "Show my pay rates" }).click();
    const current = phone.page.getByRole("region", { name: "Current rates" });
    await expect(current).toContainText("Job$25.00");
    await expect(current).toContainText("Drive$18.00");
    await expect(current).toContainText("Ride$15.50");
    await expect(phone.page.getByRole("timer")).toContainText("Hiding in");
    await phone.page.getByRole("button", { name: "Hide now" }).click();
    await expect(phone.page.getByText("$25.00")).toHaveCount(0);
    // Still signed in afterwards (the password check didn't touch the session).
    await phone.page.goto("/time-clock");
    await expect(phone.page.getByRole("heading", { name: "Time Clock", level: 1 })).toBeVisible();
  } finally {
    await office.c.close();
    await phone.c.close();
  }
});
