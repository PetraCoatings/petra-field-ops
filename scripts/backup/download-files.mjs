// Downloads every file in every Supabase Storage bucket into OUT_DIR/<bucket>/<path>.
// Needs SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SECRET_KEY.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const out = process.argv[2];
const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!out || !base || !key) {
  console.error("usage: download-files.mjs OUT_DIR (with SUPABASE_URL and SUPABASE_SECRET_KEY set)");
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function call(path, init = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base}/storage/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
    if (res.ok) return res;
    if (attempt >= 4 || res.status < 500) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
}

async function list(bucket, prefix) {
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await call(`object/list/${bucket}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    const page = await res.json();
    items.push(...page);
    if (page.length < 1000) return items;
  }
}

let files = 0;
let bytes = 0;
async function walk(bucket, prefix) {
  for (const item of await list(bucket, prefix)) {
    const path = prefix + item.name;
    if (item.id === null) {
      await walk(bucket, `${path}/`); // a folder
      continue;
    }
    const res = await call(`object/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
    const body = Buffer.from(await res.arrayBuffer());
    const target = join(out, bucket, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);
    files++;
    bytes += body.length;
  }
}

const buckets = await (await call("bucket")).json();
for (const b of buckets) await walk(b.id, "");
console.log(`Downloaded ${files} files (${(bytes / 1e6).toFixed(1)} MB) from ${buckets.length} buckets`);
