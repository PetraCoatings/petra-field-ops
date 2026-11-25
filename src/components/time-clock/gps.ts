import type { ClockPress } from "@/lib/actions/time-clock";

/**
 * Location for clock actions, without making anyone wait.
 *
 * warmGps() asks for a fix as soon as a Time Clock screen opens, so by the
 * time a button is pressed a fresh one is usually ready and the press goes
 * through instantly. readGps() uses a fix up to 2 minutes old; otherwise it
 * waits at most a few seconds. Denied, unavailable or slow GPS is recorded
 * as such and the press still goes through (its time is always the moment
 * of the tap, taken before any of this).
 */
const FRESH_MS = 2 * 60_000;
let last: { gps: Extract<ClockPress["gps"], { status: "captured" }>; at: number } | null = null;
let inFlight: Promise<ClockPress["gps"]> | null = null;

function request(timeoutMs: number): Promise<ClockPress["gps"]> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve({ status: "unavailable" });
  if (inFlight) return inFlight;
  inFlight = new Promise<ClockPress["gps"]>((resolve) => {
    let done = false;
    const finish = (g: ClockPress["gps"]) => {
      if (done) return;
      done = true;
      resolve(g);
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        const gps = { status: "captured" as const, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
        last = { gps, at: Date.now() };
        finish(gps);
      },
      (err) => {
        clearTimeout(timer);
        finish({ status: err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: FRESH_MS },
    );
  }).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Start getting a location in the background (when a Time Clock screen opens). */
export function warmGps(): void {
  if (last && Date.now() - last.at < FRESH_MS) return;
  void request(15_000);
}

/** A location for a press: a recent one right away, or wait at most `maxWaitMs`. */
export async function readGps(maxWaitMs = 4_000): Promise<ClockPress["gps"]> {
  if (last && Date.now() - last.at < FRESH_MS) return last.gps;
  return Promise.race([request(maxWaitMs), new Promise<ClockPress["gps"]>((r) => setTimeout(() => r({ status: "timeout" }), maxWaitMs + 500))]);
}
