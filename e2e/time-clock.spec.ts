import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { createTestProject, deleteTestProject, employeeId, updateTestProject } from "./support/test-project";
import { signInAs } from "./support/sign-in";

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
    await signInAs(page, installer);
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
    type Ev = { event_type: string; gps_status: string; gps_source: string | null; actor_employee_id: string };
    const load = async () => (await (await api(`/rest/v1/time_events?select=event_type,gps_status,gps_source,actor_employee_id&employee_id=eq.${emp}&order=effective_at`)).json()) as Ev[];
    // The screen updates as soon as the press is accepted; give the last save a moment.
    await expect.poll(async () => (await load()).map((e) => e.event_type)).toEqual(["clock_in", "switch", "break_start", "break_end", "clock_out"]);
    const events = await load();
    expect(events[0]).toMatchObject({ gps_status: "captured", gps_source: "own_device", actor_employee_id: emp });
    // GPS on a switch follows the company setting ("record GPS when switching").
    const [{ gps_on_category_switch: gpsOnSwitch }] = (await (await api("/rest/v1/app_settings?select=gps_on_category_switch")).json()) as { gps_on_category_switch: boolean }[];
    expect(events[1].gps_status).toBe(gpsOnSwitch ? "captured" : "not_requested");
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
      await signInAs(page, u);
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
  await updateTestProject(job.id, { crew_lead_id: await employeeId(lead) }); // the job's crew lead
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
    await signInAs(page, u);
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
    await expect(old.getByRole("button", { name: "Fix", exact: true })).toHaveCount(0);
    await old.getByRole("button", { name: "Ask for a fix" }).click();
    await me.page.getByLabel("What needs fixing?").fill("I worked until 3 PM that day");
    await me.page.getByRole("button", { name: "Send request" }).click();
    await expect(me.page.getByText("Request sent to your crew lead, project manager and the office.")).toBeVisible();

    // ---- …but today's time can be fixed, with a reason; the original is kept
    await me.page.goto("/time-clock/timesheet");
    await me.page.getByRole("button", { name: "Add missed time" }).click();
    const start = Date.now() - 3 * 3_600_000;
    await me.page.getByLabel("Start", { exact: true }).fill(chicagoLocal(start));
    await me.page.getByLabel("End", { exact: true }).fill(chicagoLocal(start + 3_600_000));
    await me.page.getByRole("group", { name: "Category" }).getByRole("button", { name: "Drive" }).click();
    await me.page.getByRole("button", { name: "Save fix" }).click();
    await expect(me.page.getByText("Write a short reason (at least 3 letters).")).toBeVisible();
    await me.page.getByLabel("Reason (required)").fill("Forgot to clock in for the drive");
    await me.page.getByRole("button", { name: "Save fix" }).click();
    await expect(me.page.getByRole("status").filter({ hasText: "Fixed." })).toBeVisible();
    const added = me.page.getByRole("region", { name: "Entries" }).getByRole("listitem").filter({ hasText: "Forgot to clock in for the drive" });
    await expect(added).toContainText("Drive");
    await added.getByRole("button", { name: "Fix", exact: true }).click();
    await me.page.getByLabel("End", { exact: true }).fill(chicagoLocal(start + 90 * 60_000));
    await me.page.getByLabel("Reason (required)").fill("Drive was 90 minutes");
    await me.page.getByRole("button", { name: "Save fix" }).click();
    await expect(me.page.getByRole("status").filter({ hasText: "Fixed." })).toBeVisible();
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
    await oldForLead.getByRole("button", { name: "Fix", exact: true }).click();
    await ld.page.getByLabel("End", { exact: true }).fill(chicagoLocal(oldStart + 3 * 3_600_000));
    await ld.page.getByLabel("Reason (required)").fill("Per text from the installer");
    await ld.page.getByRole("button", { name: "Save fix" }).click();
    await expect(ld.page.getByRole("status").filter({ hasText: "Fixed." })).toBeVisible();
    await ld.page.getByLabel("Note (optional)").fill("Changed to 3 hours");
    await ld.page.getByRole("button", { name: "Mark resolved" }).click();
    await expect(ld.page.getByText(/Resolved by .* Changed to 3 hours/)).toBeVisible();
    await ld.page.getByRole("button", { name: "Submit week to the office" }).click();
    await expect(ld.page.getByRole("status").filter({ hasText: "Week submitted to the office." })).toBeVisible();
    await expect(ld.page.getByRole("region", { name: "Week status" })).toContainText("Submitted");
    await expect(ld.page.getByRole("button", { name: "Fix", exact: true })).toHaveCount(0); // the lead can't change it now

    // ---- The office approves (locks), then reopens with a reason
    const of = await signIn(admin);
    contexts.push(of);
    await of.page.goto(`/manage/time?week=${week}`);
    await of.page.getByRole("link", { name: new RegExp(installer.firstName) }).filter({ hasText: "Submitted" }).click();
    await of.page.getByRole("button", { name: "Approve and lock week" }).click();
    await expect(of.page.getByRole("region", { name: "Week status" })).toContainText("Approved (locked)");
    await expect(of.page.getByRole("button", { name: "Fix", exact: true })).toHaveCount(0);
    await of.page.getByLabel("Reason to reopen (required)").fill("Missing drive time");
    await of.page.getByRole("button", { name: "Reopen week" }).click();
    await expect(of.page.getByRole("region", { name: "Week status" })).toContainText("Reopened by");
    await expect(of.page.getByRole("region", { name: "Week status" })).toContainText("Open");
  } finally {
    for (const x of contexts) await x.c.close();
    await deleteTestProject(job.id);
  }
});

test("no signal: presses are saved on the phone and sent with their original times", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run covers offline clocking");
  test.setTimeout(150_000);
  const installer = readRoleUsers().find((x) => x.role === "installer")!;
  const emp = await employeeId(installer);
  const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await signInAs(page, installer);
    await expect(page).toHaveURL(/\/$/);
    // One online visit saves the app's offline pages (including the Time Clock).
    await page.goto("/calculators");
    await expect(page.getByText("Saved on this phone: the calculators work without signal.")).toBeVisible({ timeout: 45_000 });
    const before = Date.now();

    // ---- No signal
    await context.setOffline(true);
    await page.goto("/time-clock");
    const status = page.getByRole("region", { name: "Right now" });
    await expect(status).toContainText("Not clocked in");
    await page.getByRole("group", { name: "What are you doing?" }).getByRole("button", { name: "Drive" }).click();
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText(/No signal: saved on this phone at/)).toBeVisible({ timeout: 20_000 });
    await expect(status).toContainText("On the clock: Drive");
    await page.getByRole("group", { name: "Switch to" }).getByRole("button", { name: "Job" }).click();
    await page.getByRole("button", { name: "Switch to Job" }).click();
    await expect(page.getByText("Saved on this phone, waiting for signal (2)")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("link", { name: "2 time clock press(es) waiting to send" })).toBeVisible();
    // Nothing reached the server yet.
    expect(((await (await api(`/rest/v1/time_events?select=id&employee_id=eq.${emp}&effective_at=gte.${new Date(before).toISOString()}`)).json()) as unknown[]).length).toBe(0);
    await page.waitForTimeout(3000); // signal comes back a little later

    // ---- Signal returns: both presses are sent, in order, with the times they were pressed
    await context.setOffline(false);
    await expect(page.getByText(/waiting for signal/)).toHaveCount(0, { timeout: 30_000 });
    const events = (await (await api(`/rest/v1/time_events?select=event_type,category,effective_at,server_received_at,flags&employee_id=eq.${emp}&effective_at=gte.${new Date(before).toISOString()}&order=effective_at`)).json()) as {
      event_type: string;
      category: string;
      effective_at: string;
      server_received_at: string;
      flags: string[];
    }[];
    expect(events.map((e) => [e.event_type, e.category])).toEqual([
      ["clock_in", "drive"],
      ["switch", "job"],
    ]);
    for (const e of events) {
      expect(Date.parse(e.server_received_at) - Date.parse(e.effective_at)).toBeGreaterThan(2500); // recorded at the press time, not the send time
      expect(e.flags).toEqual([]);
    }
    await page.reload();
    await expect(status).toContainText("On the clock: Job");

    // ---- A press the server refuses stays visible on the Sync page until dismissed
    await page.evaluate((owner) => {
      const list = JSON.parse(localStorage.getItem("petra.outbox.v1") ?? "[]");
      const id = crypto.randomUUID();
      list.push({ id, kind: "clock", owner, state: "pending", createdAt: new Date().toISOString(), payload: { id, action: "clock_in", category: "ride", deviceTs: new Date().toISOString(), gps: { status: "not_requested" } } });
      localStorage.setItem("petra.outbox.v1", JSON.stringify(list));
    }, emp);
    await page.goto("/sync");
    await page.getByRole("button", { name: "Send now" }).click();
    const refused = page.getByRole("list", { name: "Time clock presses on this phone" }).getByRole("listitem").filter({ hasText: "Not accepted" });
    await expect(refused).toContainText("The server didn't accept it: You're already clocked in.");
    await expect(page.getByRole("link", { name: "1 time clock press(es) not accepted" })).toBeVisible();
    await refused.getByRole("button", { name: "Remove from this list" }).click();
    await expect(page.getByText("Not accepted")).toHaveCount(0);

    // Clean up: clock out (online).
    await page.goto("/time-clock");
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.getByRole("button", { name: "Yes, clock out" }).click();
    await expect(status).toContainText("Not clocked in");
  } finally {
    await context.close();
  }
});

// A small real image standing in for a camera photo.
const PNG_2x2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNwaDgARAwQCgAoDgYBQzpj2gAAAABJRU5ErkJggg==", "base64");

test("plan acceptance: offline clock-in, daily report draft and photo all arrive after reconnecting", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.skip((await api("/rest/v1/photos?select=id&limit=1")).status === 404, "field reporting migrations not applied");
  test.setTimeout(180_000);
  const users = readRoleUsers();
  const lead = users.find((x) => x.role === "crew_lead")!;
  const installer = users.find((x) => x.role === "installer")!;
  const leadId = await employeeId(lead);
  const job = await createTestProject([lead, installer]);
  await updateTestProject(job.id, { crew_lead_id: leadId });
  const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await signInAs(page, lead);
    await expect(page).toHaveURL(/\/$/);
    // In the morning, with signal: the app saves its offline pages; the lead opens the job and today's report.
    await page.goto("/calculators");
    await expect(page.getByText("Saved on this phone: the calculators work without signal.")).toBeVisible({ timeout: 45_000 });
    await page.goto(`/jobs/${job.id}`);
    await page.getByRole("button", { name: "Write a daily report for today" }).click();
    await expect(page).toHaveURL(/\/reports\/\d{4}-\d{2}-\d{2}$/);
    const reportUrl = new URL(page.url()).pathname;
    await page.goto(`/jobs/${job.id}`); // saved again, now showing today's report
    const before = new Date().toISOString();

    // ---- No signal for the rest of the day
    await context.setOffline(true);
    await page.goto("/time-clock");
    await page.getByRole("group", { name: "What are you doing?" }).getByRole("button", { name: "Job" }).click();
    await page.getByRole("button", { name: "Clock in" }).click();
    await expect(page.getByText(/No signal: saved on this phone at/)).toBeVisible({ timeout: 20_000 });

    await page.goto(reportUrl);
    await page.getByLabel("Work performed").fill("Ground and primed bays 1–3 with no signal on site.");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText("No signal: saved on this phone. It will send when you have signal.")).toBeVisible({ timeout: 20_000 });

    await page.goto(`/jobs/${job.id}`);
    const photos = page.getByRole("region", { name: "Photos" });
    // (Wait until the saved page has started up, as a person would, before choosing.)
    const stage = photos.getByLabel("Stage");
    await expect(async () => {
      await stage.selectOption({ label: "Primer" });
      await expect(stage).toHaveValue("primer", { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await photos.getByTestId("photo-input").setInputFiles({ name: "IMG_0100.png", mimeType: "image/png", buffer: PNG_2x2 });
    await expect(photos.getByText("1 photo(s) saved on this phone. They'll upload when you have signal.")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "3 time clock press(es) waiting to send" })).toBeVisible();
    // Nothing has reached the server.
    expect(((await (await api(`/rest/v1/photos?select=id&project_id=eq.${job.id}`)).json()) as unknown[]).length).toBe(0);

    // ---- Signal returns: all three arrive
    await context.setOffline(false);
    await expect(page.getByRole("link", { name: /waiting to send/ })).toHaveCount(0, { timeout: 45_000 });
    const events = (await (await api(`/rest/v1/time_events?select=event_type,category&employee_id=eq.${leadId}&effective_at=gte.${before}`)).json()) as { event_type: string; category: string }[];
    expect(events).toEqual([{ event_type: "clock_in", category: "job" }]);
    const reports = (await (await api(`/rest/v1/daily_field_reports?select=version,draft&project_id=eq.${job.id}`)).json()) as { version: number; draft: { workPerformed?: string } }[];
    expect(reports[0].draft.workPerformed).toBe("Ground and primed bays 1–3 with no signal on site.");
    expect(reports[0].version).toBe(2);
    const stored = (await (await api(`/rest/v1/photos?select=stage,storage_path&project_id=eq.${job.id}`)).json()) as { stage: string; storage_path: string }[];
    expect(stored).toHaveLength(1);
    expect(stored[0].stage).toBe("primer");

    // Clean up: clock out (online).
    await page.goto("/time-clock");
    await page.getByRole("button", { name: "Clock out" }).click();
    await page.getByRole("button", { name: "Yes, clock out" }).click();
    await expect(page.getByRole("region", { name: "Right now" })).toContainText("Not clocked in");
  } finally {
    await context.close();
    const list = await api("/storage/v1/object/list/job-photos", { method: "POST", body: JSON.stringify({ prefix: job.id, limit: 100 }) });
    if (list.ok) {
      const names = ((await list.json()) as { name: string }[]).map((o) => `${job.id}/${o.name}`);
      if (names.length) await api("/storage/v1/object/job-photos", { method: "DELETE", body: JSON.stringify({ prefixes: names }) });
    }
    await deleteTestProject(job.id);
  }
});

test("weak signal at the end of the day: the crew lead can still open crew clock-in and clock everyone out", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.setTimeout(150_000);
  const users = readRoleUsers();
  const lead = users.find((x) => x.role === "crew_lead")!;
  const installer = users.find((x) => x.role === "installer")!;
  const [leadId, instId] = [await employeeId(lead), await employeeId(installer)];
  const job = await createTestProject([lead, installer]);
  await updateTestProject(job.id, { crew_lead_id: leadId });
  const context = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  try {
    const page = await context.newPage();
    await signInAs(page, lead);
    await expect(page).toHaveURL(/\/$/);
    // In the morning, with signal: the app saves its offline pages, and the lead clocks the crew in.
    await page.goto("/calculators");
    await expect(page.getByText("Saved on this phone: the calculators work without signal.")).toBeVisible({ timeout: 45_000 });
    await page.goto("/time-clock/crew");
    await page.getByLabel("Job", { exact: true }).selectOption(job.id);
    await page.getByRole("button", { name: /^Clock in/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "✓" })).toHaveCount(1, { timeout: 20_000 });

    // Leaving the job, no signal; the app is closed and opened again.
    await context.setOffline(true);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "No connection" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("link", { name: "Crew clock-in (crew leads)" }).click();
    await expect(page.getByRole("button", { name: /^Clock out/ })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("Job", { exact: true }).selectOption(job.id);
    await page.getByRole("button", { name: /^Clock out/ }).click();
    await page.getByRole("button", { name: "Yes, clock out" }).click();
    // Shown as saved (not as an error), and nothing reached the server yet.
    await expect(page.getByRole("status").filter({ hasText: /saved on this phone at .* No need to press again/ })).toBeVisible({ timeout: 25_000 });
    await expect(page.getByRole("alert").filter({ hasText: /saved on this phone/ })).toHaveCount(0);

    // Back in signal: the clock-out is sent with the time it was pressed.
    await context.setOffline(false);
    await page.goto("/sync");
    await expect(page.getByText(/waiting for signal/)).toHaveCount(0, { timeout: 30_000 });
    for (const emp of [leadId, instId]) {
      await expect
        .poll(async () => {
          const ev = (await (await api(`/rest/v1/time_events?select=event_type,is_group_action&employee_id=eq.${emp}&order=effective_at.desc&limit=1`)).json()) as { event_type: string; is_group_action: boolean }[];
          return ev[0]?.event_type;
        })
        .toBe("clock_out");
    }
  } finally {
    await context.close();
    await deleteTestProject(job.id);
  }
});
