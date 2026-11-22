import { inflateSync } from "node:zlib";

/**
 * Pulls the visible text out of a PDF made with the standard Helvetica font
 * (as the work order PDFs are): inflates the content streams and decodes the
 * text-showing operators. Good enough for tests to check what's on the page.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const parts: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      parts.push(inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"));
    } catch {
      // not a compressed content stream (fonts, images)
    }
  }
  const content = parts.join("\n");
  const lines: string[] = [];
  for (const m of content.matchAll(/\[(.*?)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
    const chunks = m[1] !== undefined ? [...m[1].matchAll(/<([0-9a-fA-F]*)>/g)].map((x) => x[1]) : [m[2]];
    lines.push(chunks.map((h) => Buffer.from(h, "hex").toString("latin1")).join(""));
  }
  return lines.join("\n");
}

/** Number of pages in the PDF. */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

/** Text with all spacing removed, for "is this phrase in the PDF?" checks that don't depend on line breaks. */
export function flat(text: string): string {
  return text.replace(/[\s\u00b7]+/g, "");
}
