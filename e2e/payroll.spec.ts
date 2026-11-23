import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { employeeId, sessionFetch } from "./support/test-project";
import { flat, pdfText } from "./support/pdf-text";
import { signInAs } from "./support/sign-in";

/**
 * The Payroll page: the plan's example week (Job 38 h × $25, Drive 6 h × $18,
 * Ride 4 h × $15 → $1,211.17) in a pay period from January 2025, far from any
 * real data. Nothing is marked entered here: payroll records are permanent.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

const post = (path: string, body: unknown) => api(path, { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });

test("payroll shows Gusto hours per rate, blocks until weeks are approved, and downloads", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one desktop run");
  test.skip((await api("/rest/v1/payroll_runs?select=id&limit=1")).status === 404, "apply supabase/migrations/20261126000200_payroll_runs.sql first");
  test.setTimeout(90_000);
  const users = readRoleUsers();
  const admin = users.find((x) => x.role === "office_admin")!;
  const installer = users.find((x) => x.role === "installer")!;
  const emp = await employeeId(installer);
  const name = ((await (await api(`/rest/v1/employees?select=display_name&id=eq.${emp}`)).json()) as { display_name: string }[])[0].display_name;
  for (const [category, hourly_rate] of [["job", 25], ["drive", 18], ["ride", 15]] as const) {
    expect((await post("/rest/v1/pay_rates", { employee_id: emp, category, hourly_rate, effective_from: "2025-01-01" })).ok).toBe(true);
  }
  // Week of Mon Jan 6, 2025 (Chicago, UTC−6): Job 9.5 h Mon–Thu, Drive 6 h Fri, Ride 4 h Sat.
  const seg = (category: string, date: string, from: string, to: string) => ({
    employee_id: emp,
    kind: "work",
    category,
    start_at: `${date}T${from}:00-06:00`,
    end_at: `${date}T${to}:00-06:00`,
  });
  const segs = ["06", "07", "08", "09"].map((d) => seg("job", `2025-01-${d}`, "06:00", "15:30"));
  segs.push(seg("drive", "2025-01-10", "06:00", "12:00"), seg("ride", "2025-01-11", "08:00", "12:00"));
  expect((await post("/rest/v1/time_segments", segs)).ok).toBe(true);

  const context = await browser.newContext({ ...devices["Desktop Chrome"], baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await signInAs(page, admin);
    await expect(page).toHaveURL(/\/$/);

    await page.goto("/manage");
    await page.getByRole("link", { name: "Payroll" }).click();
    await page.goto("/manage/payroll?period=2025-01-08");
    await expect(page.getByText(/Pay period .*Jan.*2025/)).toBeVisible();
    const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: name }) });
    await expect(row).toContainText("38.00");
    await expect(row).toContainText("6.00");
    await expect(row).toContainText("4.00");
    await expect(row).toContainText("48.00");
    await expect(row).toContainText("8.00");
    await expect(row).toContainText("$1,211.17");
    // The week isn't approved yet: payroll can't be marked entered.
    await expect(page.getByText(new RegExp(`${name}: week of Jan 6 isn't approved yet`))).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark as entered in Gusto" })).toBeDisabled();

    // Approve the week; then it can be marked (not done here: records are permanent).
    expect((await post("/rest/v1/timesheets", { employee_id: emp, week_start: "2025-01-06T06:00:00Z", week_end: "2025-01-13T06:00:00Z", status: "approved" })).ok).toBe(true);
    await page.reload();
    await expect(page.getByText(/isn't approved yet/)).toHaveCount(0);
    await page.getByRole("button", { name: "Mark as entered in Gusto" }).click();
    await expect(page.getByText("Did you finish typing these hours into Gusto?")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // Downloads
    const csv = await (await context.request.get("/manage/payroll/export?period=2025-01-08&format=csv")).text();
    expect(csv).toContain(`${name},Hourly,2,2025-01-06,Job,25.00,38.00,48.00,40.00,8.00,1211.17`);
    expect(csv).toContain(`${name},Hourly,2,2025-01-06,Ride,15.00,4.00,48.00,40.00,8.00,1211.17`);
    const pdfRes = await context.request.get("/manage/payroll/export?period=2025-01-08&format=pdf");
    expect(pdfRes.headers()["content-type"]).toBe("application/pdf");
    const text = flat(pdfText(Buffer.from(await pdfRes.body())));
    expect(text).toContain(flat(name));
    expect(text).toContain("$1,211.17");
  } finally {
    await context.close();
  }

  // Not for anyone else.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const p2 = await other.newPage();
  await signInAs(p2, installer);
  await expect(p2).toHaveURL(/\/$/);
  expect((await other.request.get("/manage/payroll/export?period=2025-01-08&format=csv")).status()).toBe(403);
  await other.close();
});

test("crew leads and project managers can't see anyone's pay rates or payroll", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one desktop run");
  test.skip((await api("/rest/v1/payroll_runs?select=id&limit=1")).status === 404, "payroll migration not applied");
  test.setTimeout(90_000);
  const users = readRoleUsers();
  const installer = users.find((x) => x.role === "installer")!;
  const emp = await employeeId(installer);
  // Make sure the installer has a rate to look for.
  await post("/rest/v1/pay_rates", { employee_id: emp, category: "job", hourly_rate: 31.25, effective_from: "2024-06-03" });
  expect(((await (await api(`/rest/v1/pay_rates?select=id&employee_id=eq.${emp}`)).json()) as unknown[]).length).toBeGreaterThan(0);

  for (const role of ["crew_lead", "project_manager"] as const) {
    const u = users.find((x) => x.role === role)!;
    // 1. Straight to the database with their own sign-in: nothing comes back.
    const as = await sessionFetch(u);
    expect(await (await as(`/rest/v1/pay_rates?select=*&employee_id=eq.${emp}`)).json()).toEqual([]);
    expect(await (await as(`/rest/v1/pay_rates?select=*&employee_id=neq.${await employeeId(u)}`)).json()).toEqual([]);
    expect(await (await as("/rest/v1/payroll_runs?select=*")).json()).toEqual([]);
    expect(await (await as("/rest/v1/payroll_lines?select=*")).json()).toEqual([]);

    // 2. Through the app's pages and downloads.
    const c = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const page = await c.newPage();
    await signInAs(page, u);
    await expect(page).toHaveURL(/\/$/);
    for (const path of [`/manage/employees/${emp}`, "/manage/payroll", "/manage/employees"]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(new RegExp(path.replace(/\//g, "\\/") + "$"));
      await expect(page.getByText("$31.25")).toHaveCount(0);
    }
    expect((await c.request.get("/manage/payroll/export?period=2025-01-08&format=csv")).status()).toBe(403);
    expect((await c.request.get("/manage/payroll/export?period=2025-01-08&format=pdf")).status()).toBe(403);
    // Their crew's timesheets show hours, never money.
    await page.goto(`/time-clock/timesheet?employee=${emp}`);
    await expect(page.getByText("$")).toHaveCount(0);
    await c.close();
  }
});
