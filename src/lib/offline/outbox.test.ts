import { describe, expect, it } from "vitest";
import { predictOpen, type ClockPayload } from "./outbox";

const press = (action: ClockPayload["action"], deviceTs: string, extra: Partial<ClockPayload> = {}): ClockPayload => ({
  id: deviceTs,
  action,
  deviceTs,
  gps: { status: "not_requested" },
  ...extra,
});

describe("status while presses wait to be sent", () => {
  it("applies waiting presses in the order they were made", () => {
    const pending = [
      press("switch", "2026-11-23T13:15:00Z", { category: "job", projectId: "p1" }),
      press("clock_in", "2026-11-23T12:00:00Z", { category: "drive" }),
    ];
    expect(predictOpen(null, pending)).toEqual({ kind: "work", category: "job", projectId: "p1", start: Date.parse("2026-11-23T13:15:00Z") });
    expect(predictOpen(null, [...pending, press("break_start", "2026-11-23T17:30:00Z")])).toMatchObject({ kind: "lunch", category: "job" });
    expect(predictOpen(null, [...pending, press("clock_out", "2026-11-23T22:45:00Z")])).toBeNull();
  });
  it("starts from what the server last said", () => {
    const server = { kind: "work" as const, category: "drive" as const, projectId: null, start: 1 };
    expect(predictOpen(server, [])).toBe(server);
    expect(predictOpen(server, [press("break_start", "2026-11-23T17:30:00Z")])).toMatchObject({ kind: "lunch", category: "drive" });
  });
});

describe("sending the queue", () => {
  it("keeps sending after a run that had nothing to send (regression)", async () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    Object.assign(globalThis, {
      window: {
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      fetch: async (_url: string, init: { body: string }) => {
        calls.push(JSON.parse(init.body).id);
        return new Response(JSON.stringify({ ok: true, results: [{ employeeId: "me", ok: true }] }), { status: 200 });
      },
    });
    const { syncOutbox, submitPress } = await import("./outbox");
    await syncOutbox("me"); // nothing waiting: finishes at once
    const item = await submitPress("me", { id: "a", action: "clock_in", category: "job", deviceTs: "2026-11-23T12:00:00Z", gps: { status: "not_requested" } }, 2000);
    expect(calls).toEqual(["a"]);
    expect(item.state).toBe("synced");
    // Sending again never repeats a confirmed press.
    await syncOutbox("me");
    expect(calls).toEqual(["a"]);
  });
});

describe("a press made while another send is under way", () => {
  it("is still sent right away", async () => {
    const store = new Map<string, string>();
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    Object.assign(globalThis, {
      window: {
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
        dispatchEvent: () => true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      fetch: async (_url: string, init: { body: string }) => {
        const id = JSON.parse(init.body).id;
        calls.push(id);
        if (id === "first") await gate; // the first send is slow
        return new Response(JSON.stringify({ ok: true, results: [{ employeeId: "me", ok: true }] }), { status: 200 });
      },
    });
    const { addToOutbox, syncOutbox, submitPress } = await import("./outbox");
    addToOutbox("me", { id: "first", action: "clock_in", category: "job", deviceTs: "2026-11-23T12:00:00Z", gps: { status: "not_requested" } });
    const slow = syncOutbox("me");
    const pressed = submitPress("me", { id: "second", action: "clock_out", deviceTs: "2026-11-23T13:00:00Z", gps: { status: "not_requested" } }, 3000);
    release();
    await slow;
    expect((await pressed).state).toBe("synced");
    expect(calls).toEqual(["first", "second"]);
  });
});
