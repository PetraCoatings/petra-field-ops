/**
 * The phone's "send when there's signal" queue for Time Clock presses
 * (docs/ARCHITECTURE_PLAN.md §8). Each press is kept on this phone with its
 * own id and the time it was tapped, and sent to /api/sync/clock in the order
 * it was made. The server ignores a press it already has (same id), so
 * resending is always safe. Nothing is dropped silently: a press the server
 * refuses stays in the list, marked, until the person dismisses it.
 *
 * States: pending (saved on this phone) → sending → synced (server confirmed)
 *         or failed (the server said no: e.g. "already clocked in").
 */
export type ClockPayload = {
  id: string;
  action: "clock_in" | "switch" | "break_start" | "break_end" | "clock_out";
  category?: "job" | "drive" | "ride" | null;
  projectId?: string | null;
  deviceTs: string;
  gps: { status: "captured"; lat: number; lng: number; accuracy: number } | { status: "denied" | "unavailable" | "timeout" | "not_requested" };
  employeeIds?: string[];
};
export type OutboxItem = {
  id: string;
  kind: "clock";
  owner: string; // employee id of the person signed in when it was saved
  payload: ClockPayload;
  state: "pending" | "sending" | "synced" | "failed";
  error?: string;
  createdAt: string;
  syncedAt?: string;
  results?: { employeeId: string; ok: boolean; error?: string }[];
};

const KEY = "petra.outbox.v1";
const EVENT = "petra-outbox";
const KEEP_SYNCED_MS = 24 * 3_600_000;

function read(): OutboxItem[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as OutboxItem[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function write(list: OutboxItem[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked: nothing more we can do here
  }
  window.dispatchEvent(new Event(EVENT));
}

export function outboxItems(): OutboxItem[] {
  const now = Date.now();
  return read().filter((i) => i.state !== "synced" || !i.syncedAt || now - Date.parse(i.syncedAt) < KEEP_SYNCED_MS);
}
export function subscribeOutbox(fn: () => void): () => void {
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", onStorage);
  };
}
function update(id: string, patch: Partial<OutboxItem>) {
  write(read().map((i) => (i.id === id ? { ...i, ...patch } : i)));
}
export function addToOutbox(owner: string, payload: ClockPayload): OutboxItem {
  const item: OutboxItem = { id: payload.id, kind: "clock", owner, payload, state: "pending", createdAt: new Date().toISOString() };
  if (!read().some((i) => i.id === item.id)) write([...read(), item]);
  return item;
}
export function dismissOutboxItem(id: string) {
  write(read().filter((i) => i.id !== id));
}
export function retryOutboxItem(id: string) {
  update(id, { state: "pending", error: undefined });
}

let running: Promise<void> | null = null;

/**
 * Sends this person's waiting presses, oldest first. Stops at the first one
 * that can't reach the server (still no signal), so order is kept.
 */
export function syncOutbox(owner: string): Promise<void> {
  if (running) return running;
  // (The flag is cleared after the run is stored: a run with nothing to send
  // finishes synchronously, and clearing it inside would leave it stuck.)
  const run = (async () => {
    {
      const waiting = read()
        .filter((i) => i.owner === owner && (i.state === "pending" || i.state === "sending"))
        .sort((a, b) => a.payload.deviceTs.localeCompare(b.payload.deviceTs));
      for (const item of waiting) {
        update(item.id, { state: "sending" });
        let res: Response;
        try {
          res = await fetch("/api/sync/clock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ ...item.payload, deviceNow: new Date().toISOString() }),
          });
        } catch {
          update(item.id, { state: "pending" });
          return; // no signal: try again later
        }
        if (res.status === 401) {
          update(item.id, { state: "pending" });
          return; // signed out: wait until they sign in again
        }
        const body = (await res.json().catch(() => null)) as { ok: boolean; error?: string; results?: OutboxItem["results"] } | null;
        if (!res.ok || !body) {
          update(item.id, { state: "pending" });
          return; // server trouble: try again later
        }
        if (!body.ok) {
          update(item.id, { state: "failed", error: body.error ?? "generic" });
          continue;
        }
        const mine = body.results?.find((r) => r.employeeId === owner) ?? body.results?.[0];
        const allFailed = body.results?.every((r) => !r.ok);
        update(item.id, {
          state: allFailed ? "failed" : "synced",
          error: allFailed ? (mine?.error ?? "generic") : undefined,
          syncedAt: new Date().toISOString(),
          results: body.results,
        });
      }
    }
  })();
  running = run.finally(() => {
    running = null;
  });
  return running;
}

/**
 * Records a press: saved on the phone first, then sent. Resolves with what
 * happened within `waitMs`: synced (with the server's answer), failed, or
 * still saved on the phone (no signal yet).
 */
export async function submitPress(owner: string, payload: ClockPayload, waitMs = 8000): Promise<OutboxItem> {
  addToOutbox(owner, payload);
  await Promise.race([syncOutbox(owner), new Promise((r) => setTimeout(r, waitMs))]);
  return read().find((i) => i.id === payload.id)!;
}

/** What the phone thinks the current status is, applying presses not sent yet on top of the server's. */
export type PredictedOpen = { kind: "work" | "lunch"; category: "job" | "drive" | "ride" | null; projectId: string | null; start: number } | null;
export function predictOpen(serverOpen: PredictedOpen, pending: ClockPayload[]): PredictedOpen {
  let open = serverOpen;
  for (const p of [...pending].sort((a, b) => a.deviceTs.localeCompare(b.deviceTs))) {
    const at = Date.parse(p.deviceTs);
    if (p.action === "clock_in" || p.action === "switch") open = { kind: "work", category: p.category ?? "job", projectId: p.projectId ?? null, start: at };
    else if (p.action === "break_start") open = open ? { ...open, kind: "lunch", start: at } : open;
    else if (p.action === "break_end") open = open ? { ...open, kind: "work", start: at } : open;
    else if (p.action === "clock_out") open = null;
  }
  return open;
}
