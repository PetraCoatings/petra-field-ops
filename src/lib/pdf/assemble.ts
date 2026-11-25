import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * Joins PDFs into one, in order, and writes "Page X of Y" at the bottom right
 * of every page (so attached drawings are numbered with everything else).
 * A part that can't be read (a damaged or password-protected attachment) is
 * left out instead of failing the whole printout; its index is returned.
 */
export async function assemblePdf(parts: Uint8Array[], pageLabel: (n: number, total: number) => string): Promise<{ pdf: Buffer; skipped: number[] }> {
  const out = await PDFDocument.create();
  const skipped: number[] = [];
  for (const [i, part] of parts.entries()) {
    try {
      const doc = await PDFDocument.load(part, { ignoreEncryption: true });
      for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page);
    } catch {
      skipped.push(i);
    }
  }
  const font = await out.embedFont(StandardFonts.Helvetica);
  const total = out.getPageCount();
  out.getPages().forEach((page, i) => {
    if (page.getRotation().angle % 360 !== 0) return; // a turned drawing page: leave it unmarked
    const label = pageLabel(i + 1, total);
    const size = 8;
    const { width } = page.getSize();
    page.drawText(label, { x: width - 40 - font.widthOfTextAtSize(label, size), y: 22, size, font, color: rgb(0.33, 0.33, 0.33) });
  });
  // Plain (not packed) structure: opens in every PDF viewer and printer driver.
  return { pdf: Buffer.from(await out.save({ useObjectStreams: false })), skipped };
}
