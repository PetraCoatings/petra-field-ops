import "server-only";
import type { NextRequest } from "next/server";

/**
 * For the phone's send-queue routes (/api/sync/*): accept only JSON sent by
 * this site's own pages. Route handlers don't get the cross-site check that
 * server actions have built in, and a cross-site form could otherwise post a
 * "simple" text body with the person's cookies.
 */
export function isSameOriginJson(request: NextRequest): boolean {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return false;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    // Behind a proxy the request URL may not carry the public host: compare hosts instead.
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}
