#!/usr/bin/env node
/**
 * Fails if anything that looks like a server secret ended up in the browser
 * bundle (.next/static). Run after `next build`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dir = ".next/static";
const forbidden = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "service_role", "sb_secret_"];
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
  for (const needle of forbidden) if (text.includes(needle)) hits.push(`${file}: contains ${needle.startsWith("SUPABASE") || needle === "service_role" || needle === "sb_secret_" ? needle : "<secret value>"}`);
}
if (hits.length) {
  console.error("Server secrets found in client bundle:\n" + hits.join("\n"));
  process.exit(1);
}
console.log("Client bundle check passed: no server secrets in .next/static.");
