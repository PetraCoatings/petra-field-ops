import { devices, expect, request as pwRequest, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { createTestProject, deleteTestProject, publishAsOffice, updateTestProject } from "./support/test-project";

/**
 * Calendar: job days from the published work order show in the app; the
 * private calendar link serves them to calendar apps without signing in; a
 * new link turns the old one off. Office admins manage holidays.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

const chicagoDate = (offsetDays: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(Date.now() + offsetDays * 86_400_000));

test("job days on the calendar and in a calendar app; holidays", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.skip((await api("/rest/v1/holidays?select=id&limit=1")).status === 404, "apply supabase/migrations/20261127000100_calendar.sql first");
  test.setTimeout(120_000);
  const users = readRoleUsers();
  const installer = users.find((x) => x.role === "installer")!;
  const pm = users.find((x) => x.role === "project_manager")!;
  const admin = users.find((x) => x.role === "office_admin")!;
  const job = await createTestProject([installer]);
  await updateTestProject(job.id, { site_street: "201 Business Pk Blvd", site_city: "Luling", site_state: "TX", site_postal_code: "78648" });
  const day1 = chicagoDate(3);
  const day2 = chicagoDate(4);
  await publishAsOffice(pm, job.id, {
    v: 1,
    schedule: [
      { title: "Day 1", date: day1, startTime: "5am", steps: [{ text: "Load up and drive to jobsite" }] },
      { title: "Day 2", date: day2, steps: [{ text: "Grind" }] },
    ],
  });
  const signIn = async (u: typeof installer) => {
    const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
    const page = await c.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill(u.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);
    return { c, page };
  };
  const me = await signIn(installer);
  const office = await signIn(admin);
  const anon = await pwRequest.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const page = me.page;
    await page.getByRole("link", { name: "Calendar" }).click();
    await page.goto(`/calendar?view=month&date=${day1}`);
    await expect(page.getByRole("link", { name: new RegExp(`, 1 events$`) }).first()).toBeVisible();
    await page.goto(`/calendar?view=week&date=${day1}`);
    const event = page.getByRole("link", { name: `${job.name} · Day 1 · start 5am` });
    await expect(event).toBeVisible();
    await expect(page.getByRole("link", { name: "201 Business Pk Blvd, Luling, TX 78648" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: `${job.name} · Day 2` })).toBeVisible();
    await event.click();
    await expect(page.getByRole("heading", { name: job.name, level: 1 })).toBeVisible();

    // ---- Calendar link: works without signing in, like a calendar app
    await page.goto("/calendar");
    await page.getByRole("button", { name: "Get my calendar link" }).click();
    const box = page.getByLabel("Or copy the link and add it as a calendar subscription:");
    await expect(box).toHaveValue(/\/calendar-feed\/[0-9a-f]{64}\.ics$/);
    await expect(page.getByRole("link", { name: "Apple Calendar (iPhone, Mac)" })).toHaveAttribute("href", /^webcal:\/\//);
    const first = new URL(await box.inputValue()).pathname;
    const res = await anon.get(first);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const ics = (await res.text()).replace(/\r\n /g, "");
    expect(ics).toContain(`SUMMARY:${job.name} · Day 1 · start 5am`);
    expect(ics).toContain(`DTSTART;VALUE=DATE:${day1.replace(/-/g, "")}`);
    expect(ics).toContain("LOCATION:201 Business Pk Blvd\\, Luling\\, TX 78648");

    // A new link turns the old one off; turning it off stops the new one.
    await page.reload();
    await expect(page.getByText(/Your calendar link is turned on/)).toBeVisible();
    await page.getByRole("button", { name: "Make a new calendar link" }).click();
    const second = new URL(await box.inputValue()).pathname;
    expect(second).not.toBe(first);
    expect((await anon.get(first)).status()).toBe(404);
    expect((await anon.get(second)).status()).toBe(200);
    await page.getByRole("button", { name: "Turn off my calendar link" }).click();
    await expect(page.getByRole("button", { name: "Get my calendar link" })).toBeVisible();
    expect((await anon.get(second)).status()).toBe(404);
    expect((await anon.get("/calendar-feed/not-a-link.ics")).status()).toBe(404);

    // ---- Holidays (a past date, so no one's real calendar shows it)
    await office.page.goto("/calendar?view=day&date=2025-01-15");
    await office.page.getByLabel("Date").fill("2025-01-15");
    await office.page.getByLabel("Name").fill("E2E Test Holiday");
    await office.page.getByRole("button", { name: "Add holiday" }).click();
    await expect(office.page.getByText("Holiday added.")).toBeVisible();
    await page.goto("/calendar?view=day&date=2025-01-15");
    await expect(page.getByText("Holiday: E2E Test Holiday")).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove holiday" })).toHaveCount(0); // installers can't
    await office.page.reload();
    await office.page.getByRole("button", { name: "Remove holiday" }).click();
    await expect(office.page.getByText("Holiday: E2E Test Holiday")).toHaveCount(0);
  } finally {
    await api("/rest/v1/holidays?name=like.E2E*", { method: "DELETE" });
    await anon.dispose();
    await me.c.close();
    await office.c.close();
    await deleteTestProject(job.id);
  }
});
