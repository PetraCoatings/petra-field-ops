import { vi } from "vitest";
vi.mock("server-only", () => ({}));
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { flat, pdfPageCount, pdfText } from "../../../e2e/support/pdf-text";
import { renderCloseoutPdf, type CloseoutModel } from "./pdf";

describe("job closeout package PDF", () => {
  it("puts the cover, daily reports, QC, issues and photos (two per page) in one PDF", async () => {
    const jpg = await sharp({ create: { width: 1200, height: 900, channels: 3, background: { r: 120, g: 120, b: 120 } } }).jpeg().toBuffer();
    const model: CloseoutModel = {
      labels: { title: "Job closeout package", contents: "Contents", dailyReports: "Daily reports", qc: "Quality control readings", issues: "Jobsite issues", photos: "Photos", page: "Page", of: "of", none: "None" },
      jobName: "Xbow RIB 3",
      coverLines: ["Job #2611", "Address: 201 Business Pk Blvd Luling, TX 78648"],
      contents: ["Work orders: 0", "Daily reports: 2", "Photos: 3"],
      warnings: ["Daily reports not yet accepted: Tue, Nov 24, 2026 (Submitted)."],
      generated: "Prepared Nov 25, 2026",
      workOrders: [],
      reports: [
        { heading: "Mon, Nov 23, 2026", status: "Accepted", meta: ["Submitted by Dakota"], blocks: [{ title: "Work performed", lines: ["Ground the floor and primed bays 1-3."] }] },
        { heading: "Tue, Nov 24, 2026", status: "Submitted", meta: [], blocks: [{ title: "Jobsite readings", lines: ["Dew point 50.5 F - Do not coat"], warn: true }] },
      ],
      qc: { headers: ["Test", "Reading", "Result", "Where", "When / by"], rows: [["Dew point", "6.5 F above dew point", "Pass", "Bay 2", "Nov 23"]] },
      issues: [{ title: "Moisture", lines: ["Slab reads 5.2 lbs", "Still open."], warn: true }],
      photos: [1, 2, 3].map((i) => ({ caption: `Primer ${i}`, sub: "Nov 23 - Dakota", notes: null, data: jpg })),
    };
    const pdf = await renderCloseoutPdf(model);
    const text = flat(pdfText(pdf));
    for (const s of ["Job closeout package", "Xbow RIB 3", "Job #2611", "Daily reports not yet accepted", "Ground the floor and primed bays 1-3.", "Quality control readings", "6.5 F above dew point", "Jobsite issues", "Slab reads 5.2 lbs", "Primer 3"]) {
      expect(text).toContain(flat(s));
    }
    // Cover + 2 reports + QC/issues + 2 photo pages (3 photos, two per page).
    expect(pdfPageCount(pdf)).toBe(6);
  });
});
