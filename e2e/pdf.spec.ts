import { expect, test, type Browser, type Page } from "@playwright/test";
import { flat, pdfPageCount, pdfText } from "./support/pdf-text";
import { readRoleUsers, signedInTestsEnabled, type RoleUser } from "./support/role-users";
import {
  addTestContact,
  createTestProject,
  deleteTestProject,
  finishTestProject,
  publishAsOffice,
  updateTestProject,
  workOrdersTableExists,
} from "./support/test-project";

/**
 * Work order PDFs: the crew on the job downloads the current revision and an
 * older one; the PDF holds the work order (and the drawing, on its own page);
 * someone not on the job can't download it until the job is finished, and
 * then without the customer's phone number.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

async function signIn(browser: Browser, u: RoleUser): Promise<Page> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  return page;
}

// 1×1 PNG standing in for a floor plan.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("work order PDFs follow the same rules as the app", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop", "one run covers PDFs");
  test.skip(!(await workOrdersTableExists()), "work orders migration not applied");
  test.setTimeout(120_000);

  const users = readRoleUsers();
  const pm = users.find((x) => x.role === "project_manager")!;
  const installer = users.find((x) => x.role === "installer")!;
  const lead = users.find((x) => x.role === "crew_lead")!;
  const job = await createTestProject([installer]);
  try {
    await updateTestProject(job.id, { name: "XBow (Crossbow), RIB 2", site_city: "Luling", site_state: "TX" });
    await addTestContact(job.id, { name: "John Janacek", title: "with CRC", phone: "(512) 550-0816" });
    const content = {
      v: 1,
      summary: [{ label: "System install", value: "6,620 sf Sika 200C Conductive System" }],
      trailerMaterials: [{ item: "Sika 200C (3.31 Gal Kit)", qty: "19 Kits + Partial" }],
      mixRatios: [{ product: "Sikafloor 200C", ratio: "2.18A : 1B : .15C : .3Pig" }],
      schedule: [{ title: "Day 1", steps: [{ text: "Sand floor extremely well, no glossy spots.", important: true }] }],
    };
    const fwoId = await publishAsOffice(pm, job.id, content);
    // Revision 2 adds a drawing (uploaded the way the office's browser does, into the work order's folder).
    const file = `${job.id}/${fwoId}/floor-plan.png`;
    const up = await fetch(`${process.env.E2E_SUPABASE_URL}/storage/v1/object/fwo-files/${file}`, {
      method: "POST",
      headers: { apikey: process.env.E2E_SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.E2E_SUPABASE_SECRET_KEY}`, "Content-Type": "image/png" },
      body: PNG,
    });
    expect(up.ok).toBe(true);
    await publishAsOffice(
      pm,
      job.id,
      { ...content, mixRatios: [{ product: "Sikafloor 200C", ratio: "2.2A : 1B" }], attachments: [{ path: file, name: "Floor plan.png", contentType: "image/png", size: PNG.length, caption: "Shop drawing" }] },
      { fwoId, changeSummary: "New ratio, floor plan" },
    );

    // ---- Installer on the job: current revision from the job screen
    const i = await signIn(browser, installer);
    await i.goto(`/jobs/${job.id}`);
    const href = await i.getByRole("link", { name: "Download PDF" }).first().getAttribute("href");
    expect(href).toBe(`/jobs/library/${fwoId}/pdf?rev=2`);
    const current = await i.request.get(href!);
    expect(current.status()).toBe(200);
    expect(current.headers()["content-type"]).toBe("application/pdf");
    expect(current.headers()["content-disposition"]).toContain("XBow (Crossbow), RIB 2 - WO 1 rev 2.pdf");
    const pdf = await current.body();
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdfPageCount(pdf)).toBe(2); // work order + drawing page
    const text = flat(pdfText(pdf));
    for (const expected of ["WORK ORDER", "XBow (Crossbow), RIB 2", "John Janacek", "(512) 550-0816", "6,620 sf Sika 200C Conductive System", "19 Kits + Partial", "2.2A : 1B", "IMPORTANT: ", "Shop drawing", "Revision 2"]) {
      expect(text, expected).toContain(flat(expected));
    }

    // ---- Revision 1 is still exactly as published
    const old = flat(pdfText(await (await i.request.get(`/jobs/library/${fwoId}/pdf?rev=1`)).body()));
    expect(old).toContain(flat("2.18A : 1B : .15C : .3Pig"));
    expect(old).not.toContain(flat("Shop drawing"));

    // ---- A crew lead not on the job: nothing while the job is active…
    const l = await signIn(browser, lead);
    expect((await l.request.get(`/jobs/library/${fwoId}/pdf`)).status()).toBe(404);
    // …and once it's finished, the PDF without the customer's phone number.
    await finishTestProject(job.id);
    const past = await l.request.get(`/jobs/library/${fwoId}/pdf`);
    expect(past.status()).toBe(200);
    const pastText = flat(pdfText(await past.body()));
    expect(pastText).toContain(flat("2.2A : 1B"));
    expect(pastText).not.toContain("Janacek");
    expect(pastText).not.toContain("550-0816");

    // ---- Signed out: no PDF
    const anon = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const res = await anon.request.get(`/jobs/library/${fwoId}/pdf`, { maxRedirects: 0 });
    expect([302, 303, 307, 401]).toContain(res.status());
  } finally {
    await deleteTestProject(job.id);
  }
});

