import "server-only";
import type { Profile } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export type ChecklistItem = {
  id: string;
  position: number;
  item: string;
  qty: string | null;
  source: "work_order" | "added";
  removed_from_work_order: boolean;
  status: "pending" | "loaded" | "missing";
  note: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type Checklist = { id: string; revision_id: string; items: ChecklistItem[] };

/** Crew leads on the job and office staff tick the checklist; installers can look. */
export function canLoadTrailer(profile: Profile): boolean {
  return profile.role === "crew_lead" || profile.role === "project_manager" || profile.role === "office_admin";
}

/** The work order's checklist, or null if nobody has started it yet. */
export async function loadChecklist(fwoId: string): Promise<Checklist | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("loading_checklists")
    .select("id, revision_id, loading_checklist_items(id, position, item, qty, source, removed_from_work_order, status, note, updated_by, updated_at)")
    .eq("fwo_id", fwoId)
    .maybeSingle();
  if (!data) return null;
  const items = ((data.loading_checklist_items ?? []) as ChecklistItem[]).sort(
    (a, b) => Number(a.removed_from_work_order) - Number(b.removed_from_work_order) || a.position - b.position,
  );
  return { id: data.id as string, revision_id: data.revision_id as string, items };
}

/** Counts over items still on the work order (or added on site). */
export function checklistCounts(items: ChecklistItem[]) {
  const active = items.filter((i) => !i.removed_from_work_order);
  return {
    total: active.length,
    loaded: active.filter((i) => i.status === "loaded").length,
    missing: active.filter((i) => i.status === "missing"),
  };
}
