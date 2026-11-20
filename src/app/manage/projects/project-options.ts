import "server-only";
import { activeDirectory } from "@/lib/db/queries";
import type { CustomerRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

/** Dropdown data for the project form. */
export async function projectFormOptions() {
  const supabase = await createClient();
  const [{ data: customers }, people] = await Promise.all([
    supabase.from("customers").select("id, name, notes").order("name"),
    activeDirectory(),
  ]);
  return {
    customers: (customers ?? []) as CustomerRow[],
    managers: people.filter((p) => p.role === "project_manager" || p.role === "office_admin"),
    leads: people.filter((p) => p.role === "crew_lead"),
    people,
  };
}
