import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { getProfile } from "@/lib/auth/dal";
import { isSameOriginJson } from "@/lib/http/same-origin";
import { createClient } from "@/lib/supabase/server";
import { recordPhotoCore } from "@/lib/photos/record-core";

/** Where phones record photos uploaded from their offline queue (see lib/offline/photo-queue.ts). */
export async function POST(request: NextRequest) {
  if (!isSameOriginJson(request)) return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  if (!(await getProfile())) return NextResponse.json({ ok: false, error: "signed_out" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const r = await recordPhotoCore(await createClient(), body);
  if (r.ok && r.projectId) revalidatePath(`/jobs/${r.projectId}`, "layout");
  return NextResponse.json({ ok: r.ok }, { status: r.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
