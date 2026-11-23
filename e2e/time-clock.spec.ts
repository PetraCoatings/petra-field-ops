import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { createTestProject, deleteTestProject, employeeId } from "./support/test-project";

/**
 * Time Clock on a phone: clock in for Drive, switch to Job on a job, lunch,
 * clock out. GPS is recorded at clock-in and clock-out with its status.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");
// Both tests clock the same installer, so they run one after the other.
test.describe.configure({ mode: "serial" });

async function timeClockExists(): Promise<boolean> {
  return (await api("/rest/v1/time_segments?select=id&limit=1")).ok;
}

test("an installer clocks in, switches, takes lunch and clocks out", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run covers the time clock");
  test.skip(!(await timeClockExists()), "apply supabase/migrations/20261125000100_time_clock.sql to the dev project first");
  test.setTimeout(90_000);
  const installer = readRoleUsers().find((x) => x.role === "installer")!;
  const job = await createTestProject([installer]);
  const context = await browser.newContext({
    ...devices["iPhone 13"],
    baseURL: test.info().project.use.baseURL,
    permissions: ["geolocation"],
    geolocation: { latitude: 29.6805, longitude: -97.6489, accuracy: 12 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByLabel("Email").fill(installer.email);
    await page.getByLabel("Password", { exact: true }).fill(installer.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByRole("link", { name: "Time Clock" }).click();
    const status = page.getByRole("region", { name: "Right now" });
    await expect(status).toContainText("Not clocked in");
    await expect(page.getByText("Don't clock in for your normal drive")).toBeVisible();

    // Drive to the job
    await page.getByRole("group", { name: "What are you doing?" }).getByRole("button", { name: "Drive" }).click();
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Clocked in at .* \(Drive\)/ })).toBeVisible();
    await expect(status).toContainText("On the clock: Drive");

    // Arrive: switch to Job on this job
    await page.getByRole("group", { name: "Switch to" }).getByRole("button", { name: "Job" }).click();
    await page.getByLabel("Job", { exact: true }).selectOption({ label: job.name });
    await page.getByRole("button", { name: "Switch to Job" }).click();
    await expect(status).toContainText("On the clock: Job");
    await expect(status).toContainText(job.name);

    // Lunch
    await page.getByRole("button", { name: "Start lunch" }).click();
    await expect(status).toContainText("On lunch");
    await page.getByRole("button", { name: "End lunch (back to Job)" }).click();
    await expect(status).toContainText("On the clock: Job");
    await expect(status).toContainText(job.name);

    // Clock out (asks first)
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.getByRole("button", { name: "Yes, clock out" }).click();
    await expect(status).toContainText("Not clocked in");

    const today = page.getByRole("region", { name: "Today" });
    await expect(today.getByRole("listitem")).toHaveCount(4);
    await expect(today.getByRole("listitem").nth(0)).toContainText("Drive");
    await expect(today.getByRole("listitem").nth(1)).toContainText(`Job · ${job.name}`);
    await expect(today.getByRole("listitem").nth(2)).toContainText("Lunch · paid (under 30 min)");

    // What the database recorded
    const emp = await employeeId(installer);
    const events = (await (await api(`/rest/v1/time_events?select=event_type,gps_status,gps_source,actor_employee_id&employee_id=eq.${emp}&order=effective_at`)).json()) as {
      event_type: string;
      gps_status: string;
      gps_source: string | null;
      actor_employee_id: string;
    }[];
    expect(events.map((e) => e.event_type)).toEqual(["clock_in", "switch", "break_start", "break_end", "clock_out"]);
    expect(events[0]).toMatchObject({ gps_status: "captured", gps_source: "own_device", actor_employee_id: emp });
    expect(events[1].gps_status).toBe("not_requested");
    expect(events[4].gps_status).toBe("captured");
  } finally {
    await context.close();
    await deleteTestProject(job.id);
  }
});

test("a crew lead clocks the crew in and out together", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run covers crew clock-in");
  test.skip(!(await timeClockExists()), "time clock migration not applied");
  test.skip((await api("/rest/v1/rpc/crew_clock_status", { method: "POST", body: JSON.stringify({ p_employee_ids: [] }) })).status === 404, "apply supabase/migrations/20261125000200_crew_clock_status.sql first");
  test.setTimeout(120_000);
  const users = readRoleUsers();
  const lead = users.find((x) => x.role === "crew_lead")!;
  const installer = users.find((x) => x.role === "installer")!;
  const pm = users.find((x) => x.role === "project_manager")!;
  const job = await createTestProject([lead, installer]);
  const ctx = (u: typeof lead) =>
    browser.newContext({
      ...devices["Pixel 7"],
      baseURL: test.info().project.use.baseURL,
      permissions: ["geolocation"],
      geolocation: { latitude: 29.6805, longitude: -97.6489, accuracy: 12 },
    }).then(async (c) => {
      const page = await c.newPage();
      await page.goto("/login");
      await page.getByLabel("Email").fill(u.email);
      await page.getByLabel("Password", { exact: true }).fill(u.password);
      await page.getByRole("button", { name: "Sign in" }).click();
      await expect(page).toHaveURL(/\/$/);
      return { c, page };
    });
  const leadSide = await ctx(lead);
  const crewSide = await ctx(installer);
  try {
    const page = leadSide.page;
    await page.goto("/time-clock");
    await page.getByRole("link", { name: "Clock in my crew" }).click();
    await expect(page.getByRole("heading", { name: "Crew clock-in", level: 1 })).toBeVisible();
    await page.getByLabel("Job", { exact: true }).selectOption({ label: job.name });
    // The job's crew is ticked: the lead and the installer.
    const people = page.getByRole("group", { name: /Who is here\?/ });
    await expect(people.getByRole("checkbox", { name: new RegExp(lead.firstName) })).toBeChecked();
    await expect(people.getByRole("checkbox", { name: new RegExp(installer.firstName) })).toBeChecked();
    // Someone not on the job can be added (here the project manager), then left out again.
    await page.getByLabel("Add someone else").selectOption({ label: await nameOf(pm) });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await people.getByRole("checkbox", { name: new RegExp(pm.firstName) }).uncheck();

    await page.getByRole("group", { name: "What are you doing?" }).getByRole("button", { name: "Job" }).click();
    await page.getByRole("button", { name: "Clock in (2)" }).click();
    const result = page.getByRole("status").filter({ hasText: "Clock in at" });
    await expect(result).toContainText(`✓ ${await nameOf(lead)}`);
    await expect(result).toContainText(`✓ ${await nameOf(installer)}`);
    await expect(people).toContainText(`On the clock: Job · ${job.name}`);

    // The installer sees it on their own phone.
    await crewSide.page.goto("/time-clock");
    await expect(crewSide.page.getByRole("region", { name: "Right now" })).toContainText("On the clock: Job");
    // …and can't open the crew screen.
    await crewSide.page.goto("/time-clock/crew");
    await expect(crewSide.page).not.toHaveURL(/\/time-clock\/crew/);

    // Clocking the installer in again is refused for them only.
    await page.getByRole("button", { name: "Clock in (2)" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Clock in at" })).toContainText("You're already clocked in.");

    await page.getByRole("button", { name: "Clock out (2)" }).click();
    await page.getByRole("button", { name: "Yes, clock out" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Clock out at" })).toContainText(`✓ ${await nameOf(installer)}`);

    const emp = await employeeId(installer);
    const leadId = await employeeId(lead);
    const events = (await (await api(`/rest/v1/time_events?select=event_type,actor_employee_id,is_group_action,gps_status,gps_source&employee_id=eq.${emp}&is_group_action=is.true&order=effective_at`)).json()) as {
      event_type: string;
      actor_employee_id: string;
      is_group_action: boolean;
      gps_status: string;
      gps_source: string;
    }[];
    expect(events.map((e) => e.event_type)).toEqual(["clock_in", "clock_out"]);
    for (const e of events) expect(e).toMatchObject({ actor_employee_id: leadId, is_group_action: true, gps_status: "captured", gps_source: "group_leader_device" });
  } finally {
    await leadSide.c.close();
    await crewSide.c.close();
    await deleteTestProject(job.id);
  }
});

async function nameOf(u: { email: string }): Promise<string> {
  const r = await api(`/rest/v1/employees?select=display_name&email=eq.${encodeURIComponent(u.email)}`);
  return ((await r.json()) as { display_name: string }[])[0].display_name;
}
