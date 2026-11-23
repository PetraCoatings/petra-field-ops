/*
 * Petra Field Ops service worker: keeps the calculators working with no signal.
 *
 * What it stores (Cache Storage, this phone only):
 *   - The calculator pages (HTML), refreshed every time they load online.
 *   - The app's versioned code and styles (/_next/static/…) those pages need.
 *   - A small "No connection" page for everything else.
 *   - Job screens and their daily report pages, each time they're opened
 *     online (daily report saves and photos made offline are kept by the
 *     page in the phone's send queues and sent when signal returns).
 *   - The Time Clock and Sync pages, so a crew member can clock in with no
 *     signal (presses are kept by the page in the phone's send queue, see
 *     src/lib/offline/outbox.ts, and sent when signal returns).
 *   - The safety data sheet list and the in-app PDF viewer, plus the PDF.js
 *     code the viewer needs. SDS files a crew member saves "on this phone" are
 *     kept by the page in the petra-sds-v1 cache.
 * Nothing else is cached: job and pay data always come from the server. The
 * saved Time Clock page shows the status as of its last online load; the page
 * applies presses still waiting to be sent on top of it.
 *
 * Rules:
 *   - Saved pages (calculators, Time Clock, Sync, SDS): network first (4 s timeout on weak signal), saved copy
 *     if offline. A redirect (signed out) or an error is never saved.
 *   - /_next/static/: saved copy first. These URLs change with every release.
 *   - Any other page while offline: the "No connection" page.
 *   - Signing in or out clears the saved pages and code (see
 *     clear-offline-data.ts). The "No connection" page is kept in its own
 *     cache, since it holds no company data.
 *
 * After each online page load the app asks for a "warm" pass, at most every
 * 10 minutes, that downloads every calculator page and its code, so they all
 * work offline even if the crew member has never opened them.
 */

const CACHE = "petra-offline-v2";
const SHELL_CACHE = "petra-shell-v1";
const OWN_CACHES = [CACHE, SHELL_CACHE];
const OFFLINE_PAGE = "/offline.html";
const OFFLINE_ROUTES = [
  "/time-clock",
  "/sync",
  "/sds",
  "/library/view",
  "/calculators",
  "/calculators/square-footage",
  "/calculators/spread-rate",
  "/calculators/material-quantity",
  "/calculators/mix-ratio",
  "/calculators/dew-point",
];
const NETWORK_TIMEOUT_MS = 4000;
const PDFJS_WORKER = "/pdfjs/pdf.worker-6.4.299.min.mjs";
const WARM_EVERY_MS = 10 * 60 * 1000;
const META_WARMED = "/__petra-offline/warmed";

const normalize = (pathname) => (pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname);
// Job screens and their daily reports: saved each time they're opened online,
// so a crew lead who opened them that morning can keep working with no signal.
const SAVED_ON_VISIT = /^\/jobs\/[0-9a-f-]{36}(\/reports\/\d{4}-\d{2}-\d{2})?$/;
const isOfflineRoute = (url) => OFFLINE_ROUTES.includes(normalize(url.pathname)) || SAVED_ON_VISIT.test(normalize(url.pathname));
const BRAND_ASSETS = ["/icons/logo.png", "/icons/favicon-32.png"];
const isStaticAsset = (url) => url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pdfjs/") || BRAND_ASSETS.includes(url.pathname);
const isCacheablePage = (res) =>
  res && res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html");

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.add(new Request(OFFLINE_PAGE, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("petra-") && !OWN_CACHES.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function calculatorPage(request) {
  const cache = await caches.open(CACHE);
  const key = normalize(new URL(request.url).pathname);
  try {
    const res = await withTimeout(fetch(request), NETWORK_TIMEOUT_MS);
    if (isCacheablePage(res)) await cache.put(key, res.clone());
    return res;
  } catch {
    return (await cache.match(key)) || (await offlinePage());
  }
}

async function offlinePage() {
  const shell = await caches.open(SHELL_CACHE);
  return (await shell.match(OFFLINE_PAGE)) || Response.error();
}

async function otherPage(request) {
  try {
    return await fetch(request);
  } catch {
    return offlinePage();
  }
}

async function staticAsset(request) {
  // The logo holds no company data: it lives with the "No connection" page and survives sign-out.
  const cache = await caches.open(BRAND_ASSETS.includes(new URL(request.url).pathname) ? SHELL_CACHE : CACHE);
  const hit = await cache.match(request, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) await cache.put(new URL(request.url).pathname, res.clone());
  return res;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isStaticAsset(url)) {
    event.respondWith(staticAsset(request));
  } else if (request.mode === "navigate") {
    event.respondWith(isOfflineRoute(url) ? calculatorPage(request) : otherPage(request));
  }
  // Everything else (RSC data, API calls, Supabase) goes straight to the network.
  // When an in-app link fails offline, Next.js falls back to a full page load,
  // which the "navigate" branch above answers from the cache.
});

/** Static asset URLs referenced by a page's HTML (scripts, styles, fonts). */
function assetUrls(html) {
  const found = new Set();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s)\\]+/g)) found.add(m[0]);
  return [...found];
}

async function warm(force) {
  const cache = await caches.open(CACHE);
  if (!force) {
    const meta = await cache.match(META_WARMED);
    if (meta && Date.now() - Number(await meta.text()) < WARM_EVERY_MS) return status();
  }
  const keep = new Set();
  for (const route of OFFLINE_ROUTES) {
    let res;
    try {
      res = await fetch(route, { credentials: "same-origin", cache: "no-store" });
    } catch {
      return status(); // went offline mid-way; keep what we have
    }
    if (!isCacheablePage(res)) return status(); // signed out or server error: don't overwrite
    const html = await res.clone().text();
    await cache.put(route, res);
    for (const a of assetUrls(html)) keep.add(a);
  }
  keep.add(PDFJS_WORKER);
  const shell = await caches.open(SHELL_CACHE);
  for (const a of BRAND_ASSETS) {
    if (await shell.match(a)) continue;
    try {
      const res = await fetch(a);
      if (res.ok) await shell.put(a, res);
    } catch {
      return status();
    }
  }
  for (const a of keep) {
    if (await cache.match(a)) continue;
    try {
      const res = await fetch(a);
      if (res.ok) await cache.put(a, res);
    } catch {
      return status();
    }
  }
  // Drop code from older releases that no calculator page uses any more.
  for (const req of await cache.keys()) {
    const p = new URL(req.url).pathname;
    if (isStaticAsset(new URL(req.url)) && !keep.has(p)) await cache.delete(req);
  }
  await cache.put(META_WARMED, new Response(String(Date.now())));
  return status();
}

/** Ready when every calculator page is saved. */
async function status() {
  const cache = await caches.open(CACHE);
  const hits = await Promise.all(OFFLINE_ROUTES.map((r) => cache.match(r)));
  return { ready: hits.every(Boolean) };
}

/**
 * A page opened by an in-app link (no full page load) asks to be saved:
 * fetch it fresh and keep it, if it's one of the pages kept for offline use.
 */
async function saveForOffline(path) {
  const url = new URL(path, self.location.origin);
  if (url.origin !== self.location.origin || !isOfflineRoute(url)) return { saved: false };
  try {
    const res = await fetch(url.pathname, { credentials: "same-origin", cache: "no-store" });
    if (!isCacheablePage(res)) return { saved: false };
    await (await caches.open(CACHE)).put(normalize(url.pathname), res);
    return { saved: true };
  } catch {
    return { saved: false };
  }
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const reply = (v) => event.ports[0] && event.ports[0].postMessage(v);
  if (data.type === "save" && typeof data.path === "string") {
    event.waitUntil(saveForOffline(data.path).then(reply, () => reply({ saved: false })));
    return;
  }
  if (data.type === "warm") event.waitUntil(warm(Boolean(data.force)).then(reply, () => reply({ ready: false })));
  else if (data.type === "status") event.waitUntil(status().then(reply));
});
