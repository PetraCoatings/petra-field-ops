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

/** Wall-clock time in Chicago as "YYYY-MM-DDTHH:MM" (what a datetime-local box holds). */
function chicagoLocal(ms: number): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

test("timesheets: fix your own time, ask for a fix, lead submits, office approves and reopens", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run covers timesheets");
  test.skip((await api("/rest/v1/timesheets?select=id&limit=1")).status === 404, "apply supabase/migrations/20261125000300_timesheets.sql first");
  test.setTimeout(150_000);
  const users = readRoleUsers();
  const installer = users.find((x) => x.role === "installer")!;
  const lead = users.find((x) => x.role === "crew_lead")!;
  const admin = users.find((x) => x.role === "office_admin")!;
  const job = await createTestProject([lead, installer]);
  const emp = await employeeId(installer);
  // An entry from 30 hours ago: too old to fix yourself (24-hour window).
  const oldStart = Date.now() - 30 * 3_600_000;
  const seeded = await api("/rest/v1/time_segments", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ employee_id: emp, kind: "work", category: "job", project_id: job.id, start_at: new Date(oldStart).toISOString(), end_at: new Date(oldStart + 2 * 3_600_000).toISOString() }),
  });
  expect(seeded.ok).toBe(true);
  const week = chicagoLocal(oldStart).slice(0, 10);
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
  const contexts: { c: { close: () => Promise<void> } }[] = [];
  try {
    // ---- The installer: an old entry can only be asked about
    const me = await signIn(installer);
    contexts.push(me);
    await me.page.goto(`/time-clock/timesheet?week=${week}`);
    await expect(me.page.getByRole("heading", { name: "My timesheet", level: 1 })).toBeVisible();
    const entries = me.page.getByRole("region", { name: "Entries" });
    const old = entries.getByRole("listitem").filter({ hasText: job.name }).first();
    await expect(old.getByRole("button", { name: "Fix" })).toHaveCount(0);
    await old.getByRole("button", { name: "Ask for a fix" }).click();
    await me.page.getByLabel("What needs fixing?").fill("I worked until 3 PM that day");
    await me.page.getByRole("button", { name: "Send request" }).click();
    await expect(me.page.getByText("Request sent to your crew lead and the office.")).toBeVisible();

    // ---- …but today's time can be fixed, with a reason; the original is kept
    await me.page.goto("/time-clock/timesheet");
    await me.page.getByRole("button", { name: "Add missed time" }).click();
    const start = Date.now() - 3 * 3_600_000;
    await me.page.getByLabel("Start", { exact: true }).fill(chicagoLocal(start));
    await me.page.getByLabel("End", { exact: true }).fill(chicagoLocal(start + 3_600_000));
    await me.page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Drive" }).click();
    await me.page.getByRole("button", { name: "Save fix" }).click();
    await expect(me.page.getByRole("alert")).toContainText("Write a short reason");
    await me.page.getByLabel("Reason (required)").fill("Forgot to clock in for the drive");
    await me.page.getByRole("button", { name: "Save fix" }).click();
    await expect(me.page.getByRole("status")).toContainText("Fixed.");
    const added = me.page.getByRole("region", { name: "Entries" }).getByRole("listitem").filter({ hasText: "Forgot to clock in for the drive" });
    await expect(added).toContainText("Drive");
    await added.getByRole("button", { name: "Fix" }).click();
    await me.page.getByLabel("End", { exact: true }).fill(chicagoLocal(start + 90 * 60_000));
    await me.page.getByLabel("Reason (required)").fill("Drive was 90 minutes");
    await me.page.getByRole("button", { name: "Save fix" }).click();
    await expect(me.page.getByRole("status")).toContainText("Fixed.");
    await expect(me.page.getByText("Change history (1)")).toBeVisible();
    await expect(me.page.getByRole("region", { name: "Entries" })).toContainText("1 h 30 min");

    // ---- The crew lead sees the request, resolves it, fixes the entry and submits the week
    const ld = await signIn(lead);
    contexts.push(ld);
    await ld.page.goto("/time-clock");
    await ld.page.getByRole("link", { name: "Crew timesheets" }).click();
    await ld.page.goto(`/time-clock/crew/timesheets?week=${week}`);
    const row = ld.page.getByRole("link", { name: new RegExp(installer.firstName) });
    await expect(row).toContainText("1 request");
    await row.click();
    await expect(ld.page.getByText("“I worked until 3 PM that day”")).toBeVisible();
    const oldForLead = ld.page.getByRole("region", { name: "Entries" }).getByRole("listitem").filter({ hasText: job.name }).first();
    await oldForLead.getByRole("button", { name: "Fix" }).click();
    await ld.page.getByLabel("End", { exact: true }).fill(chicagoLocal(oldStart + 3 * 3_600_000));
    await ld.page.getByLabel("Reason (required)").fill("Per text from the installer");
    await ld.page.getByRole("button", { name: "Save fix" }).click();
    await expect(ld.page.getByRole("status")).toContainText("Fixed.");
    await ld.page.getByLabel("Note (optional)").fill("Changed to 3 hours");
    await ld.page.getByRole("button", { name: "Mark resolved" }).click();
    await expect(ld.page.getByText(/Resolved by .* Changed to 3 hours/)).toBeVisible();
    await ld.page.getByRole("button", { name: "Submit week to the office" }).click();
    await expect(ld.page.getByRole("status")).toContainText("Week submitted to the office.");
    await expect(ld.page.getByRole("region", { name: "Week status" })).toContainText("Submitted");
    await expect(ld.page.getByRole("button", { name: "Fix" })).toHaveCount(0); // the lead can't change it now

    // ---- The office approves (locks), then reopens with a reason
    const of = await signIn(admin);
    contexts.push(of);
    await of.page.goto(`/manage/time?week=${week}`);
    await of.page.getByRole("link", { name: new RegExp(installer.firstName) }).filter({ hasText: "Submitted" }).click();
    await of.page.getByRole("button", { name: "Approve and lock week" }).click();
    await expect(of.page.getByRole("region", { name: "Week status" })).toContainText("Approved (locked)");
    await expect(of.page.getByRole("button", { name: "Fix" })).toHaveCount(0);
    await of.page.getByLabel("Reason to reopen (required)").fill("Missing drive time");
    await of.page.getByRole("button", { name: "Reopen week" }).click();
    await expect(of.page.getByRole("region", { name: "Week status" })).toContainText("Reopened by");
    await expect(of.page.getByRole("region", { name: "Week status" })).toContainText("Open");
  } finally {
    for (const x of contexts) await x.c.close();
    await deleteTestProject(job.id);
  }
});
