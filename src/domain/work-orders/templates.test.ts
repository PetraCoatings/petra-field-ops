import { describe, expect, it } from "vitest";
import { newWorkOrderContent, readContent, type WorkOrderContent } from "./content";
import { checkTemplateContent, insertTemplate, templateSummary, toTemplateContent } from "./templates";

const template: WorkOrderContent = readContent({
  v: 1,
  summary: [{ label: "System install", value: "Sika 200C Conductive" }, { label: "Prep machine", value: "Lavina Grinder" }],
  trailerMaterials: [{ item: "Sika 200C (3.31 Gal Kit)", qty: "per job" }],
  mixRatios: [{ product: "Sikafloor 200C", ratio: "2.18A : 1B : .15C : .3Pig" }],
  schedule: [
    { title: "Prep day", startTime: "6:00 AM", steps: [{ text: "Grind to CSP 2-3", important: false }] },
    { title: "Coat day", steps: [{ text: "Apply 200C at 16 mils", important: true }] },
  ],
  safety: [{ text: "Respirators while sanding", important: true }],
  qcTests: [{ test: "Resistance to ground", target: "per spec" }],
  notes: "Ground every bolt.",
});

describe("insertTemplate", () => {
  it("into a brand-new work order: fills empty summary rows and replaces the empty Day 1", () => {
    const r = insertTemplate(newWorkOrderContent(), template);
    expect(r.summary.find((x) => x.label === "System install")?.value).toBe("Sika 200C Conductive");
    expect(r.summary.find((x) => x.label === "Available power")?.value).toBe(""); // untouched
    expect(r.summary).toHaveLength(3); // "Prep machine" filled, not added twice
    expect(r.schedule.map((d) => d.title)).toEqual(["Prep day", "Coat day"]);
    expect(r.mixRatios).toEqual(template.mixRatios);
    expect(r.notes).toBe("Ground every bolt.");
  });

  it("into a work order already in progress: appends, never overwrites", () => {
    const draft = readContent({
      ...newWorkOrderContent(),
      summary: [{ label: "System install", value: "6,620 sf conductive" }],
      trailerMaterials: [{ item: "Floor buffers" }],
      schedule: [{ title: "Day 1", date: "2026-11-19", steps: [{ text: "Load up", important: false }] }],
      notes: "Gate code 1234.",
    });
    const r = insertTemplate(draft, template);
    expect(r.summary[0]).toEqual({ label: "System install", value: "6,620 sf conductive" });
    expect(r.summary).toContainEqual({ label: "System install", value: "Sika 200C Conductive" }); // kept both, office decides
    expect(r.trailerMaterials.map((m) => m.item)).toEqual(["Floor buffers", "Sika 200C (3.31 Gal Kit)"]);
    expect(r.schedule.map((d) => d.title)).toEqual(["Day 1", "Prep day", "Coat day"]); // a real Day 1 stays
    expect(r.notes).toBe("Gate code 1234.\n\nGround every bolt.");
  });

  it("is a copy: editing the work order afterwards never changes the template", () => {
    const before = structuredClone(template);
    const r = insertTemplate(newWorkOrderContent(), template);
    r.schedule[0].steps[0].text = "Changed on this job";
    r.mixRatios[0].ratio = "1A : 1B";
    r.safety.push({ text: "Extra", important: false });
    expect(template).toEqual(before);
  });

  it("inserting twice adds the items twice (the office can remove extras)", () => {
    const r = insertTemplate(insertTemplate(newWorkOrderContent(), template), template);
    expect(r.mixRatios).toHaveLength(2);
    expect(r.schedule).toHaveLength(4);
  });
});

describe("toTemplateContent", () => {
  it("drops job-specific dates and drawings, keeps everything else", () => {
    const wo = readContent({
      ...template,
      schedule: [{ title: "Day 1", date: "2027-01-11", startTime: "6am", steps: [{ text: "Load up", important: false }] }],
      attachments: [{ path: "p/f/plan.png", name: "plan.png", contentType: "image/png", size: 10 }],
    });
    const t = toTemplateContent(wo);
    expect(t.schedule[0]).toEqual({ title: "Day 1", startTime: "6am", steps: [{ text: "Load up", important: false }] });
    expect(t.attachments).toEqual([]);
    expect(t.mixRatios).toEqual(template.mixRatios);
    expect(wo.attachments).toHaveLength(1); // the work order itself is untouched
  });
});

describe("checkTemplateContent", () => {
  it("accepts a template and refuses drawings", () => {
    expect(checkTemplateContent(template).ok).toBe(true);
    expect(checkTemplateContent({ attachments: [{ path: "a/b/c.png", name: "c.png", contentType: "image/png", size: 1 }] }).ok).toBe(false);
  });
});

describe("templateSummary", () => {
  it("counts what a template adds", () => {
    expect(templateSummary(template)).toEqual({ days: 2, steps: 2, materials: 1, mixRatios: 1, other: 5 });
  });
});

describe("products in templates", () => {
  const P = "11111111-1111-4111-8111-111111111111";
  const V = "22222222-2222-4222-8222-222222222222";
  it("save-as-template keeps products but not their pinned data sheet versions", () => {
    const wo = readContent({ ...template, products: [{ productId: P, name: "Sikafloor 264", tdsVersionId: V, sdsVersionId: V }] });
    expect(toTemplateContent(wo).products).toEqual([{ productId: P, name: "Sikafloor 264" }]);
  });
  it("inserting a template adds its products once", () => {
    const t = readContent({ ...template, products: [{ productId: P, name: "Sikafloor 264" }] });
    const r = insertTemplate(insertTemplate(newWorkOrderContent(), t), t);
    expect(r.products).toEqual([{ productId: P, name: "Sikafloor 264" }]);
  });
});
