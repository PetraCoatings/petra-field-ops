import { devices, expect, test, type Browser } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { createTestProject, deleteTestProject, employeeId, updateTestProject } from "./support/test-project";
import { signInAs } from "./support/sign-in";

/**
 * Time off: an installer asks; their crew lead approves (notified); the office
 * gives the final approval; the installer is notified and it's on the
 * calendar. A second request is turned down by the crew lead with a reason.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

const chicagoDate = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(Date.now() + offsetDays * 86_400_000));

async function signIn(browser: Browser, u: RoleUser) {
  const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  const page = await c.newPage();
  await signInAs(page, u);
  await expect(page).toHaveURL(/\/$/);
  return { c, page };
}

test("time off: request, crew lead, office, calendar; and a no with a reason", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.skip((await api("/rest/v1/time_off_requests?select=id&limit=1")).status === 404, "apply supabase/migrations/20261127000200_time_off.sql first");
  test.setTimeout(150_000);
  const users = readRoleUsers();
  const installer = users.find((x) => x.role === "installer")!;
  const lead = users.find((x) => x.role === "crew_lead")!;
  const admin = users.find((x) => x.role === "office_admin")!;
  const job = await createTestProject([lead, installer]);
  await updateTestProject(job.id, { crew_lead_id: await employeeId(lead) });
  const name = ((await (await api(`/rest/v1/employees?select=display_name&id=eq.${await employeeId(installer)}`)).json()) as { display_name: string }[])[0].display_name;
  const leadName = ((await (await api(`/rest/v1/employees?select=display_name&id=eq.${await employeeId(lead)}`)).json()) as { display_name: string }[])[0].display_name;
  const first = chicagoDate(40);
  const last = chicagoDate(41);
  const me = await signIn(browser, installer);
  const ld = await signIn(browser, lead);
  const of = await signIn(browser, admin);
  try {
    // ---- The installer asks
    await me.page.getByRole("link", { name: "Calendar" }).click();
    await me.page.getByRole("link", { name: "Time off: ask or approve" }).click();
    await me.page.getByLabel("Kind").selectOption({ label: "Vacation" });
    await me.page.getByLabel("First day").fill(first);
    await me.page.getByLabel("Last day").fill(last);
    await me.page.getByLabel("Note (optional)").fill("Family trip");
    await me.page.getByRole("button", { name: "Send request" }).click();
    await expect(me.page.getByText("Request sent.")).toBeVisible();
    const mine = me.page.getByRole("region", { name: "My requests" });
    await expect(mine).toContainText("Waiting for the crew lead.");

    // ---- The crew lead is notified and approves (a "no" needs a reason)
    await ld.page.goto("/notifications");
    await ld.page.getByRole("button", { name: new RegExp(`Time-off request from ${name}`) }).first().click();
    await expect(ld.page).toHaveURL(/\/time-off$/);
    const waiting = ld.page.getByRole("region", { name: /Waiting for your decision/ });
    const item = waiting.getByRole("listitem").filter({ hasText: "Family trip" });
    await item.getByRole("button", { name: "Say no" }).click();
    await expect(item.getByText("Write a reason for saying no.")).toBeVisible();
    await item.getByRole("button", { name: "Approve (send to the office)" }).click();
    await expect(ld.page.getByRole("region", { name: /Waiting for your decision/ })).toHaveCount(0);

    // ---- The office gives the final approval
    await of.page.goto("/time-off");
    const officeItem = of.page.getByRole("region", { name: /Waiting for your decision/ }).getByRole("listitem").filter({ hasText: "Family trip" });
    await expect(officeItem).toContainText(`Approved by ${leadName}; waiting for the office.`);
    await officeItem.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(of.page.getByRole("region", { name: "Everyone's upcoming time off" })).toContainText(name);

    // ---- The installer is told, and it's on the calendar
    await me.page.goto("/notifications");
    await expect(me.page.getByRole("button", { name: /Time off approved/ }).first()).toBeVisible();
    await me.page.goto("/time-off");
    await expect(me.page.getByRole("region", { name: "My requests" })).toContainText("Approved by");
    await me.page.goto(`/calendar?view=week&date=${first}`);
    await expect(me.page.getByText(`Time off: ${name}: Vacation`).first()).toBeVisible();
    // The crew lead sees their crew's time off too.
    await ld.page.goto(`/calendar?view=day&date=${first}`);
    await expect(ld.page.getByText(`Time off: ${name}: Vacation`)).toBeVisible();

    // ---- A second request: the crew lead says no, with a reason
    await me.page.goto("/time-off");
    await me.page.getByLabel("First day").fill(chicagoDate(50));
    await me.page.getByLabel("Last day").fill(chicagoDate(50));
    await me.page.getByLabel("Only part of the day? Hours (optional)").fill("4");
    await me.page.getByLabel("Note (optional)").fill("Doctor");
    await me.page.getByRole("button", { name: "Send request" }).click();
    await expect(me.page.getByText("Request sent.")).toBeVisible();
    await ld.page.goto("/time-off");
    const second = ld.page.getByRole("region", { name: /Waiting for your decision/ }).getByRole("listitem").filter({ hasText: "Doctor" });
    await expect(second).toContainText("(4 h)");
    await second.getByLabel("Note (required to say no)").fill("We pour that day");
    await second.getByRole("button", { name: "Say no" }).click();
    await me.page.goto("/time-off");
    await expect(me.page.getByRole("region", { name: "My requests" })).toContainText(`Not approved by ${leadName}: We pour that day`);
  } finally {
    await me.c.close();
    await ld.c.close();
    await of.c.close();
    await deleteTestProject(job.id);
  }
});
