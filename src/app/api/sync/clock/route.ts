import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth/dal";
import { isSameOriginJson } from "@/lib/http/same-origin";
import { createClient } from "@/lib/supabase/server";
import { runClockPress } from "@/lib/time/clock-core";

/**
 * Where phones send Time Clock presses from their "send when there's signal"
 * queue. A plain URL rather than a server action, so a page saved on the
 * phone before an app update can still send its queue afterwards. Safe to
 * call twice: each press carries its own id.
 */
export async function POST(request: NextRequest) {
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  const profile = await getProfile();
  if (!profile) return NextResponse.json({ ok: false, error: "signed_out" }, { status: 401 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const r = await runClockPress(await createClient(), body);
  if (r.ok) {
    revalidatePath("/time-clock");
    revalidatePath("/time-clock/crew");
  }
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
