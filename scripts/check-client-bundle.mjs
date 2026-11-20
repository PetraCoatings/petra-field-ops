#!/usr/bin/env node
/**
 * Fails if anything that looks like a server secret ended up in the browser
 * bundle (.next/static). Run after `next build`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = ".next/static";
const forbidden = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "service_role"];
// An actual secret key, not just the prefix: supabase-js itself contains the
// literal "sb_secret_" (it checks which kind of key it was given).
const secretKeyPattern = /sb_secret_[A-Za-z0-9_-]{16,}/;
for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (process.env[name]) forbidden.push(process.env[name]);
}

function* files(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|css|html|json)$/.test(f)) yield p;
  }
}

const hits = [];
for (const file of files(dir)) {
  const text = readFileSync(file, "utf8");
  for (const needle of forbidden) if (text.includes(needle)) hits.push(`${file}: contains ${needle.startsWith("SUPABASE") || needle === "service_role" ? needle : "<secret value>"}`);
  if (secretKeyPattern.test(text)) hits.push(`${file}: contains an sb_secret_ key`);
}
if (hits.length) {
  console.error("Server secrets found in client bundle:\n" + hits.join("\n"));
  process.exit(1);
}
console.log("Client bundle check passed: no server secrets in .next/static.");
