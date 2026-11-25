import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";
import sharp from "sharp";
import { devices, expect, test } from "@playwright/test";
import { flat, pdfText } from "./support/pdf-text";
import { api, readRoleUsers, signedInTestsEnabled } from "./support/role-users";
import { signInAs } from "./support/sign-in";
import { createTestProject, deleteTestProject, employeeId, publishAsOffice, sessionFetch, updateTestProject } from "./support/test-project";

/**
 * Job closeout package: the office prints one PDF with the work order, the
 * daily reports, QC readings and photos. The crew can't.
 */
test.skip(!signedInTestsEnabled(), "needs a dev Supabase project (E2E_SUPABASE_* variables)");

test("the office prints a job's closeout package: work order, daily reports, QC and photos in one PDF", async ({ browser }) => {
  test.skip(test.info().project.name !== "phone", "one phone run");
  test.setTimeout(180_000);
  const users = readRoleUsers();
  const lead = users.find((x) => x.role === "crew_lead")!;
  const pm = users.find((x) => x.role === "project_manager")!;
  const leadId = await employeeId(lead);
  const job = await createTestProject([lead]);
  await updateTestProject(job.id, { crew_lead_id: leadId, project_manager_id: await employeeId(pm) });

  // A published work order, a submitted daily report, a QC reading and a photo.
  const woContent = { v: 1, notes: "Grind and prime all bays.", trailerMaterials: [{ item: "Grinder" }] };
  const fwoId = await publishAsOffice(pm, job.id, woContent);
  // Revision 2 attaches a PDF drawing (like the grounding-point diagram).
  const drawing = await PDFDocument.create();
  drawing.addPage([792, 612]).drawText("GROUNDING POINT DIAGRAM", { x: 60, y: 520, size: 24, font: await drawing.embedFont(StandardFonts.Helvetica) });
  const drawingBytes = await drawing.save();
  const file = `${job.id}/${fwoId}/grounding.pdf`;
  expect((await api(`/storage/v1/object/fwo-files/${file}`, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: new Uint8Array(drawingBytes) })).ok).toBe(true);
  await publishAsOffice(pm, job.id, { ...woContent, attachments: [{ path: file, name: "Grounding.pdf", contentType: "application/pdf", size: drawingBytes.length, caption: "Grounding points" }] }, { fwoId, changeSummary: "Grounding diagram" });
  const asLead = await sessionFetch(lead);
  const rpc = async (fn: string, args: object) => {
    const r = await asLead(`/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
    return r.json();
  };
  const reportId = (await rpc("ensure_daily_report", { p_project_id: job.id, p_date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) })) as string;
  const v = (await rpc("save_daily_report", { p_id: reportId, p_content: { v: 1, crew: [{ name: "E2E crew_lead" }], workPerformed: "Primed bays 1 through 3.", readings: [], materials: [], notes: "", nextSteps: "", areas: "" }, p_based_on: 1 })) as number;
  await rpc("submit_daily_report", { p_id: reportId, p_based_on: v });
  const [{ id: phTypeId }] = (await (await api("/rest/v1/qc_test_types?select=id&code=eq.ph")).json()) as { id: string }[];
  await rpc("record_qc_measurement", { p_project_id: job.id, p_test_type_id: phTypeId, p_value: 9.5, p_location: "Bay 1" });
  const clientId = randomUUID();
  const jpg = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 90, g: 110, b: 130 } } }).jpeg().toBuffer();
  for (const [path, body] of [
    [`${job.id}/${clientId}.jpg`, jpg],
    [`${job.id}/${clientId}_thumb.jpg`, jpg],
  ] as const) {
    const up = await api(`/storage/v1/object/job-photos/${path}`, { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array(body) });
    expect(up.ok).toBe(true);
  }
  const ins = await api("/rest/v1/photos", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ client_id: clientId, project_id: job.id, uploaded_by: leadId, stage: "primer", storage_path: `${job.id}/${clientId}.jpg`, thumb_path: `${job.id}/${clientId}_thumb.jpg`, width: 1600, height: 1200, size_bytes: jpg.length }),
  });
  expect(ins.ok).toBe(true);

  const office = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  const crew = await browser.newContext({ ...devices["iPhone 13"], baseURL: test.info().project.use.baseURL });
  try {
    const page = await office.newPage();
    await signInAs(page, pm);
    await page.goto(`/jobs/${job.id}`);
    const link = page.getByRole("link", { name: "Print closeout package" });
    await expect(link).toHaveAttribute("href", `/jobs/${job.id}/closeout`);
    // The work order PDF prints the attached drawing after the work order, numbered with it.
    const wo = await page.request.get(`/jobs/library/${fwoId}/pdf`);
    expect(wo.ok()).toBe(true);
    const woText = flat(pdfText(await wo.body()));
    expect(woText).toContain(flat("Grind and prime all bays."));
    expect(woText).toContain(flat("GROUNDING POINT DIAGRAM"));
    expect(woText.indexOf(flat("Grind and prime all bays."))).toBeLessThan(woText.indexOf(flat("GROUNDING POINT DIAGRAM")));
    expect(woText).toMatch(/Page2of2/);

    const res = await page.request.get(`/jobs/${job.id}/closeout`, { timeout: 120_000 });
    expect(res.ok()).toBe(true);
    expect(res.headers()["content-type"]).toContain("application/pdf");
    const text = flat(pdfText(await res.body()));
    for (const s of ["Job closeout package", job.name, "Contents", "Work orders: 1", "Daily reports: 1", "Photos: 1", "Grind and prime all bays.", "GROUNDING POINT DIAGRAM", "Primed bays 1 through 3.", "Daily reports not yet accepted", "Quality control readings", "Surface pH", "Bay 1", "Primer"]) {
      expect(text, s).toContain(flat(s));
    }

    // The crew can't print it.
    const cp = await crew.newPage();
    await signInAs(cp, lead);
    await cp.goto(`/jobs/${job.id}`);
    await expect(cp.getByRole("link", { name: "Print closeout package" })).toHaveCount(0);
    expect((await cp.request.get(`/jobs/${job.id}/closeout`)).status()).toBe(403);
  } finally {
    await office.close();
    await crew.close();
    await api(`/storage/v1/object/job-photos`, { method: "DELETE", body: JSON.stringify({ prefixes: [`${job.id}/${clientId}.jpg`, `${job.id}/${clientId}_thumb.jpg`] }) });
    await deleteTestProject(job.id);
  }
});
