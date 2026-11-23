import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { createTestProject, deleteTestProject, employeeId } from "./support/test-project";

/**
 * Time Clock on a phone: clock in for Drive, switch to Job on a job, lunch,
 * clock out. GPS is recorded at clock-in and clock-out with its status.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

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
