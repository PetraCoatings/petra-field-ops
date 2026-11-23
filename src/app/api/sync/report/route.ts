import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth/dal";
import { isSameOriginJson } from "@/lib/http/same-origin";
import { createClient } from "@/lib/supabase/server";
import { saveReportCore } from "@/lib/reports/save-core";

/** Where phones send daily report saves made with no signal (see lib/offline/outbox.ts). */
export async function POST(request: NextRequest) {
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  if (!(await getProfile())) return NextResponse.json({ ok: false, error: "signed_out" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const r = await saveReportCore(await createClient(), body ?? {});
  if (r.ok) revalidatePath("/jobs", "layout");
  return NextResponse.json(r, { headers: { "Cache-Control": "no-store" } });
}
