// Copies the PDF.js worker and standard fonts into public/pdfjs/ so the
// in-app PDF viewer can load them from the app's own origin (also offline).
// Runs after `npm install` / `npm ci` (postinstall). The copied files are not
// committed (see .gitignore).
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = join(root, "node_modules", "pdfjs-dist");
if (!existsSync(pkgDir)) process.exit(0);
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const out = join(root, "public", "pdfjs");
mkdirSync(out, { recursive: true });
cpSync(join(pkgDir, "legacy", "build", "pdf.worker.min.mjs"), join(out, `pdf.worker-${version}.min.mjs`));
cpSync(join(pkgDir, "standard_fonts"), join(out, "standard_fonts"), { recursive: true });
console.log(`pdfjs ${version} assets copied to public/pdfjs`);
