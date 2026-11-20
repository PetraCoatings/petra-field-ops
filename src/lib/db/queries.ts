import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { DirectoryRow } from "./types";

/** Names for a set of employee ids (via the RLS-safe directory view). */
export async function directoryNames(ids: (string | null | undefined)[]): Promise<Map<string, DirectoryRow>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (unique.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("employee_directory").select("*").in("id", unique);
  return new Map((data ?? []).map((r: DirectoryRow) => [r.id, r]));
}

export async function activeDirectory(): Promise<DirectoryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employee_directory")
    .select("*")
    .eq("is_active", true)
    .order("last_name")
    .order("first_name");
  return (data ?? []) as DirectoryRow[];
}
