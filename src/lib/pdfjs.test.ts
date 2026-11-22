import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { PDFJS_VERSION, PDFJS_WORKER_URL } from "./pdfjs";

describe("PDF.js version", () => {
  it("matches package.json and the service worker", () => {
    expect(pkg.dependencies["pdfjs-dist"]).toBe(PDFJS_VERSION);
    expect(readFileSync("public/sw.js", "utf8")).toContain(`const PDFJS_WORKER = "${PDFJS_WORKER_URL}";`);
  });
});
