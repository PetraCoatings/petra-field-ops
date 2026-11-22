/**
 * PDF.js asset locations. The worker is copied into public/pdfjs/ by
 * scripts/copy-pdfjs-assets.mjs; public/sw.js caches it for offline use.
 * Keep PDFJS_VERSION in step with package.json (a unit test checks).
 */
export const PDFJS_VERSION = "6.4.299";
export const PDFJS_WORKER_URL = `/pdfjs/pdf.worker-${PDFJS_VERSION}.min.mjs`;
export const PDFJS_STANDARD_FONTS_URL = "/pdfjs/standard_fonts/";
