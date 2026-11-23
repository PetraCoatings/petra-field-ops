import { devices, expect, test } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { createTestProject, deleteTestProject } from "./support/test-project";
import { signInAs } from "./support/sign-in";

/**
 * Security fixes seen from a phone (migration 20261129000100): a clock press
 * sent long after it was pressed is flagged on the timesheet; one more than
 * three days old is refused. The send-queue only takes the app's own requests.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("late clock presses: flagged on the timesheet, refused after 3 days; cross-site sends refused", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run is enough");
  test.skip((await api("/rest/v1/projects?select=is_test&limit=1")).status !== 200, "apply supabase/migrations/20261129000100_security_hardening.sql first");
  // Its own installer would clash with the time clock tests, so use the PM (tracks hours, never clocked by those tests).
  const pm = readRoleUsers().find((x) => x.role === "project_manager")!;
  const job = await createTestProject([pm]);
  const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  try {
    const page = await c.newPage();
    await signInAs(page, pm);
    await expect(page).toHaveURL(/\/$/);

    const send = (body: object, headers: Record<string, string> = { "Content-Type": "application/json" }) =>
      page.evaluate(
        async ({ body, headers }) => {
          const r = await fetch("/api/sync/clock", { method: "POST", headers, body: JSON.stringify(body) });
          return { status: r.status, json: await r.json() };
        },
        { body, headers },
      );
    const press = (action: string, agoMs: number) => ({
      id: crypto.randomUUID(),
      action,
      category: action === "clock_in" ? "job" : null,
      projectId: action === "clock_in" ? job.id : null,
      deviceTs: new Date(Date.now() - agoMs).toISOString(),
      deviceNow: new Date().toISOString(),
      gps: { status: "denied" },
    });

    // Not JSON (what a cross-site form could send): refused before anything else.
    expect((await send(press("clock_in", 0), { "Content-Type": "text/plain" })).status).toBe(400);
    // Pressed 4 days ago, only now reaching the office: refused.
    const old = await send(press("clock_in", 4 * 86_400_000));
    expect(old.json.results[0]).toMatchObject({ ok: false, error: "too_late" });
    // Pressed 2 hours ago with no signal: kept, and flagged.
    expect((await send(press("clock_in", 2 * 3_600_000))).json.results[0]).toMatchObject({ ok: true });
    expect((await send(press("clock_out", 0))).json.results[0]).toMatchObject({ ok: true });

    await page.goto("/time-clock/timesheet");
    await expect(page.getByText(/was sent from the phone more than 15 minutes after it was pressed/)).toBeVisible();
  } finally {
    await c.close();
    await deleteTestProject(job.id);
  }
});
