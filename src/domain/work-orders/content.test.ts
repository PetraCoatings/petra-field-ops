import { describe, expect, it } from "vitest";
import { checkContent, isEmptyContent, newWorkOrderContent, readContent } from "./content";

const where = { projectId: "p1", fwoId: "f1" };

/** Petra's Crossbow RIB 2 work order (2026-11-18), as the editor would send it. */
const crossbow = {
  v: 1,
  summary: [
    { label: "System install", value: "6,620 sf Sika 200C Conductive System" },
    { label: "Available power", value: "Bring Big Generator (MQ)" },
    { label: "Prep machine", value: "Lavina Grinder, Floor Buffers" },
  ],
  trailerMaterials: [
    { item: "Sika 264 (4.5 Gallon kit + Bag)", qty: "10" },
    { item: "Sika 220W (1.4 Gal Kit)", qty: "13 Kits" },
    { item: "Sika 200C (3.31 Gal Kit) (A+B+2 ESD Pack)", qty: "19 Kits + Partial" },
    { item: "Floor Buffers", qty: "" },
    { item: "", qty: "" },
  ],
  jobsiteMaterials: [{ item: "Copper Tape, Grounding Bolts", note: "Travis bringing" }],
  mixRatios: [
    { product: "Sikafloor 264 (plus 1 bag sand per kit)", ratio: "2A : 1B" },
    { product: "Sikafloor 200C (Kit is A+B+2C+2Pigment)", ratio: "2.18A : 1B : .15C : .3Pig" },
  ],
  schedule: [
    {
      title: "Day 1",
      date: "2026-11-19",
      startTime: "6:00 AM",
      steps: [
        { text: "Load up and drive to jobsite, arrive by 10am.", important: false },
        { text: "Do not damage anything, especially sheetrock, with cords or hoses.", important: true },
        { text: "", important: false },
      ],
    },
    { title: "Day 3", steps: [{ text: "Apply 200C at 16 mils, 350 sf/kit (100 sf/gal).", important: true }] },
  ],
  safety: [{ text: "Wear respirators while sanding.", important: true }],
  attachments: [{ path: "p1/f1/floor-plan.png", name: "Floor plan.png", contentType: "image/png", size: 120_000 }],
};

describe("checkContent", () => {
  it("accepts a real work order and drops completely blank rows", () => {
    const r = checkContent(crossbow, where);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.content.trailerMaterials).toHaveLength(4);
    expect(r.content.trailerMaterials[3]).toEqual({ item: "Floor Buffers" }); // blank qty removed
    expect(r.content.schedule[0].steps).toHaveLength(2);
    expect(r.content.schedule[0].steps[1].important).toBe(true);
    expect(r.content.mixRatios[1].ratio).toBe("2.18A : 1B : .15C : .3Pig");
  });

  it("keeps a partly filled row and reports what's missing", () => {
    const r = checkContent({ ...crossbow, mixRatios: [{ product: "Sikafloor 1620", ratio: "" }] }, where);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0].path).toBe("mixRatios.0.ratio");
  });

  it("refuses files from another work order's folder", () => {
    const r = checkContent(
      { ...crossbow, attachments: [{ path: "p1/other/x.pdf", name: "x.pdf", contentType: "application/pdf", size: 10 }] },
      where,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses unsupported file types and oversized files", () => {
    const exe = { path: "p1/f1/x.exe", name: "x.exe", contentType: "application/x-msdownload", size: 10 };
    expect(checkContent({ attachments: [exe] }, where).ok).toBe(false);
    const huge = { path: "p1/f1/x.pdf", name: "x.pdf", contentType: "application/pdf", size: 50 * 1024 * 1024 };
    expect(checkContent({ attachments: [huge] }, where).ok).toBe(false);
  });

  it("refuses absurdly long text", () => {
    expect(checkContent({ notes: "x".repeat(10_001) }, where).ok).toBe(false);
  });

  it("an untouched new work order validates and counts as empty", () => {
    const r = checkContent(newWorkOrderContent(), where);
    expect(r.ok).toBe(true);
    if (r.ok) expect(isEmptyContent(r.content)).toBe(true);
  });

  it("drops an untouched 'Day 2' but keeps a renamed or dated day", () => {
    const r = checkContent({ schedule: [{ title: "Day 2", steps: [] }, { title: "Cure day", steps: [] }] }, where);
    expect(r.ok && r.content.schedule.map((d) => d.title)).toEqual(["Cure day"]);
  });
});

describe("readContent", () => {
  it("never throws on junk; falls back to an empty work order", () => {
    expect(readContent(null).schedule).toHaveLength(1);
    expect(readContent({ summary: "nope" }).summary).toHaveLength(3);
  });
  it("fills defaults for sections added later", () => {
    expect(readContent({ v: 1, notes: "Hi" }).customSections).toEqual([]);
  });
});
