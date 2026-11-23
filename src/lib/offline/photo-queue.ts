/**
 * Photos taken with no signal wait in this phone's IndexedDB (they're too big
 * for the Time Clock's queue) and upload in the background when signal
 * returns: files first, then the record (/api/sync/photo). Each photo keeps
 * the id it was given on the phone, so a retry never saves it twice. A photo
 * the server refuses stays listed, marked, until removed.
 */
import { createClient } from "@/lib/supabase/client";
import type { PhotoStage } from "@/domain/reports/field";

export type QueuedPhoto = {
  clientId: string;
  owner: string;
  projectId: string;
  stage: PhotoStage;
  notes?: string;
  issueId?: string;
  full: Blob;
  thumb: Blob;
  width: number;
  height: number;
  takenAt: string;
  createdAt: string;
  state: "pending" | "failed";
};

const DB = "petra-photos";
const STORE = "queue";
const COUNTS = "petra.photoq.v1"; // { [owner]: { pending, failed } } so the header badge can read it instantly
const EVENT = "petra-outbox";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "clientId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(db.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export async function queuedPhotos(): Promise<QueuedPhoto[]> {
  try {
    return (await tx<QueuedPhoto[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedPhoto[]>)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  } catch {
    return [];
  }
}
async function refreshCounts() {
  const counts: Record<string, { pending: number; failed: number }> = {};
  for (const p of await queuedPhotos()) {
    const c = (counts[p.owner] ??= { pending: 0, failed: 0 });
    c[p.state === "failed" ? "failed" : "pending"]++;
  }
  try {
    window.localStorage.setItem(COUNTS, JSON.stringify(counts));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(EVENT));
}
export function photoCounts(owner: string): { pending: number; failed: number } {
  try {
    return (JSON.parse(window.localStorage.getItem(COUNTS) ?? "{}") as Record<string, { pending: number; failed: number }>)[owner] ?? { pending: 0, failed: 0 };
  } catch {
    return { pending: 0, failed: 0 };
  }
}

export async function enqueuePhoto(p: Omit<QueuedPhoto, "createdAt" | "state">): Promise<void> {
  await tx("readwrite", (s) => s.put({ ...p, createdAt: new Date().toISOString(), state: "pending" }));
  await refreshCounts();
}
export async function removeQueuedPhoto(clientId: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(clientId));
  await refreshCounts();
}
export async function retryQueuedPhoto(clientId: string): Promise<void> {
  const all = await queuedPhotos();
  const p = all.find((x) => x.clientId === clientId);
  if (p) await tx("readwrite", (s) => s.put({ ...p, state: "pending" }));
  await refreshCounts();
}

/** True when an error looks like "no signal" rather than "the server said no". */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return /fetch|network|load failed|offline|timed? ?out/i.test(msg);
}

/** Uploads both files and saves the record. "network" means try again later. */
export async function sendPhoto(p: Pick<QueuedPhoto, "clientId" | "projectId" | "stage" | "notes" | "issueId" | "full" | "thumb" | "width" | "height" | "takenAt">): Promise<"ok" | "network" | "refused"> {
  try {
    const supabase = createClient();
    const base = `${p.projectId}/${p.clientId}`;
    for (const [path, blob] of [
      [`${base}.jpg`, p.full],
      [`${base}_thumb.jpg`, p.thumb],
    ] as const) {
      const { error } = await supabase.storage.from("job-photos").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error && !/exists|duplicate/i.test(error.message)) return isNetworkError(error) ? "network" : "refused";
    }
    const res = await fetch("/api/sync/photo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        clientId: p.clientId,
        projectId: p.projectId,
        stage: p.stage,
        notes: p.notes,
        issueId: p.issueId,
        width: p.width,
        height: p.height,
        sizeBytes: p.full.size,
        takenAt: p.takenAt,
      }),
    });
    if (res.status === 401 || res.status >= 500) return "network";
    return res.ok ? "ok" : "refused";
  } catch (e) {
    return isNetworkError(e) ? "network" : "refused";
  }
}

let running: Promise<number> | null = null;

/** Uploads this person's waiting photos, oldest first; stops when there's no signal. Returns how many were sent. */
export function syncPhotos(owner: string): Promise<number> {
  if (running) return running;
  const run = (async () => {
    let sent = 0;
    for (const p of (await queuedPhotos()).filter((x) => x.owner === owner && x.state === "pending")) {
      const r = await sendPhoto(p);
      if (r === "network") break;
      if (r === "ok") {
        await tx("readwrite", (s) => s.delete(p.clientId));
        sent++;
      } else {
        await tx("readwrite", (s) => s.put({ ...p, state: "failed" }));
      }
    }
    await refreshCounts();
    return sent;
  })();
  running = run.finally(() => {
    running = null;
  });
  return running;
}
