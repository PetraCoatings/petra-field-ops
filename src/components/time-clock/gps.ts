import type { ClockPress } from "@/lib/actions/time-clock";

/**
 * Asks the phone for its location once, for a clock action. Never blocks the
 * press: denied, unavailable or slow GPS is recorded as such and the press
 * still goes through.
 */
export function readGps(timeoutMs = 10_000): Promise<ClockPress["gps"]> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve({ status: "unavailable" });
    let done = false;
    const finish = (g: ClockPress["gps"]) => {
      if (!done) {
        done = true;
        resolve(g);
      }
    };
    const timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs + 1000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({ status: "captured", lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) });
      },
      (err) => {
        clearTimeout(timer);
        finish({ status: err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable" });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
