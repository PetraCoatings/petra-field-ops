import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { flat, pdfPageCount, pdfText } from "../../../e2e/support/pdf-text";
import { assemblePdf } from "./assemble";

async function onePager(text: string, pages = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]).drawText(`${text} ${i + 1}`, { x: 50, y: 700, size: 14, font });
  return doc.save();
}

describe("joining PDFs (work order + attached drawings)", () => {
  it("keeps every page in order and numbers them all; skips a file it can't read", async () => {
    const { pdf, skipped } = await assemblePdf(
      [await onePager("WORK ORDER", 2), new TextEncoder().encode("not a pdf"), await onePager("GROUNDING DIAGRAM")],
      (n, total) => `Page ${n} of ${total}`,
    );
    expect(skipped).toEqual([1]);
    expect(pdfPageCount(pdf)).toBe(3);
    const text = flat(pdfText(pdf));
    for (const s of ["WORK ORDER 1", "WORK ORDER 2", "GROUNDING DIAGRAM 1", "Page 1 of 3", "Page 3 of 3"]) expect(text).toContain(flat(s));
    expect(text.indexOf(flat("WORK ORDER 2"))).toBeLessThan(text.indexOf(flat("GROUNDING DIAGRAM 1")));
  });
});
