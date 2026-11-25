import { devices, expect, test, type Browser } from "@playwright/test";
import { api, readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import { createTestProject, deleteTestProject, employeeId, updateTestProject } from "./support/test-project";
import { signInAs } from "./support/sign-in";

/**
 * Photos (add, retag, remove) and jobsite issues (report with a photo, the PM
 * is notified, resolve) on a phone.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

// A small real image (2×2 PNG) standing in for a camera photo.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGM40OAARAwQCgAsDgYB7KiQrwAAAABJRU5ErkJggg==", "base64");

async function signIn(browser: Browser, u: RoleUser) {
  const c = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  const page = await c.newPage();
  await signInAs(page, u);
  await expect(page).toHaveURL(/\/$/);
  return { c, page };
}

async function removeStoredPhotos(projectId: string) {
  const list = await api("/storage/v1/object/list/job-photos", { method: "POST", body: JSON.stringify({ prefix: projectId, limit: 100 }) });
  if (!list.ok) return;
  const names = ((await list.json()) as { name: string }[]).map((o) => `${projectId}/${o.name}`);
  if (names.length) await api("/storage/v1/object/job-photos", { method: "DELETE", body: JSON.stringify({ prefixes: names }) });
}

test("photos and jobsite issues", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.skip((await api("/rest/v1/photos?select=id&limit=1")).status === 404, "apply supabase/migrations/20261128000200_issues_photos.sql first");
  test.setTimeout(150_000);
  const users = readRoleUsers();
  const installer = users.find((x) => x.role === "installer")!;
  const pm = users.find((x) => x.role === "project_manager")!;
  const job = await createTestProject([installer]);
  await updateTestProject(job.id, { project_manager_id: await employeeId(pm) });
  const me = await signIn(browser, installer);
  const office = await signIn(browser, pm);
  try {
    // ---- Photos
    const page = me.page;
    await page.goto(`/jobs/${job.id}`);
    const photos = page.getByRole("region", { name: "Photos" });
    await photos.getByLabel("Stage").selectOption({ label: "Before" });
    await expect(photos.locator("[data-ready]").first()).toHaveAttribute("data-ready", "true");
    await photos.getByTestId("photo-input").setInputFiles({ name: "IMG_0001.png", mimeType: "image/png", buffer: PNG });
    await expect(photos.getByRole("status")).toContainText("1 photo(s) added.");
    await photos.getByRole("link", { name: /Before/ }).first().click();
    await expect(page.getByRole("heading", { name: "Before", level: 1 })).toBeVisible();
    await expect(page.getByRole("img", { name: "Job photo: Before" })).toBeVisible();
    await page.getByLabel("Stage").selectOption({ label: "Primer" });
    await page.getByLabel("Note").fill("Bay 2 after the first coat");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("heading", { name: "Primer", level: 1 })).toBeVisible();
    // Stored as a JPEG, both full size and thumbnail.
    const rows = (await (await api(`/rest/v1/photos?select=storage_path,thumb_path,width,height,notes&project_id=eq.${job.id}`)).json()) as { storage_path: string; width: number; notes: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ width: 2, notes: "Bay 2 after the first coat" });
    expect(rows[0].storage_path).toMatch(new RegExp(`^${job.id}/[0-9a-f-]+\\.jpg$`));
    await page.getByRole("button", { name: "Remove photo" }).click();
    await expect(page).toHaveURL(new RegExp(`/jobs/${job.id}/photos$`));
    await expect(page.getByText("No photos yet.")).toBeVisible();

    // ---- Issue with a photo; the PM is told
    await page.goto(`/jobs/${job.id}`);
    const issues = page.getByRole("region", { name: "Jobsite issues" });
    await issues.getByRole("button", { name: "Report an issue" }).click();
    await issues.getByLabel("Kind of issue").selectOption({ label: "Moisture" });
    await issues.getByLabel("What happened?").fill("Slab reads 5.2 lbs on the calcium chloride test in bay 2.");
    await issues.getByLabel("Needs attention now").check();
    await issues.getByLabel("Photos (optional)").setInputFiles({ name: "IMG_0002.png", mimeType: "image/png", buffer: PNG });
    await issues.getByRole("button", { name: "Send to the PM" }).click();
    await expect(issues.getByText("needs attention")).toBeVisible();
    await expect(issues.getByRole("img", { name: "Issue photo" })).toBeVisible();

    await office.page.goto("/notifications");
    await office.page.getByRole("button", { name: /Needs attention: issue reported by/ }).filter({ hasText: job.name }).click();
    await expect(office.page).toHaveURL(new RegExp(`/jobs/${job.id}#issues$`));
    const pmIssues = office.page.getByRole("region", { name: "Jobsite issues" });
    await pmIssues.getByLabel("What was done (optional)").fill("Moisture mitigation primer added to the work order");
    await pmIssues.getByRole("button", { name: "Mark resolved" }).click();
    await expect(pmIssues.getByText(/Resolved by .* Moisture mitigation primer/)).toBeVisible({ timeout: 15_000 });
    // The installer sees it resolved; the issue's photo stays with the job.
    await page.reload();
    await expect(page.getByRole("region", { name: "Jobsite issues" }).getByText("· resolved")).toBeVisible();
  } finally {
    await me.c.close();
    await office.c.close();
    await removeStoredPhotos(job.id);
    await deleteTestProject(job.id);
  }
});
