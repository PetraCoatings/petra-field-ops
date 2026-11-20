/**
 * Row shapes for the Phase 1 tables (hand-written; mirrors
 * supabase/migrations/20261120000100_foundation.sql).
 */
import type { AppRole } from "@/lib/auth/roles";
import type { ProjectStatus } from "@/components/ui/status-badge";

export type EmployeeRow = {
  id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  display_name: string;
  email: string;
  phone: string | null;
  role: AppRole;
  flsa_status: "nonexempt" | "exempt";
  preferred_locale: "en" | "es";
  hire_date: string | null;
  is_active: boolean;
};

export type DirectoryRow = Pick<EmployeeRow, "id" | "first_name" | "last_name" | "display_name" | "role" | "is_active">;

export type CustomerRow = { id: string; name: string; notes: string | null };

export type ProjectRow = {
  id: string;
  job_number: string | null;
  name: string;
  customer_id: string | null;
  site_street: string | null;
  site_city: string | null;
  site_state: string | null;
  site_postal_code: string | null;
  project_manager_id: string | null;
  crew_lead_id: string | null;
  scheduled_start: string | null;
  estimated_duration_days: number | null;
  scope_summary: string | null;
  total_sqft: string | null; // numeric arrives as a string — keeps exact decimals
  flooring_system: string | null;
  status: ProjectStatus;
};

export type ProjectContactRow = {
  id: string;
  project_id: string;
  name: string;
  title: string | null;
  phone: string | null;
  email: string | null;
  is_primary: boolean;
};

export type AssignmentRow = {
  id: string;
  project_id: string;
  employee_id: string;
  role_on_job: "lead" | "installer";
};

export type AppSettingsRow = {
  company_name: string;
  company_timezone: string;
  workweek_start_dow: number;
  workweek_start_time: string;
  self_edit_window_hours: number;
  gps_on_category_switch: boolean;
  dew_point_margin_f: string;
};

export const PROJECT_STATUSES: ProjectStatus[] = [
  "draft",
  "scheduled",
  "in_progress",
  "on_hold",
  "completed",
  "closed",
];

export function formatAddress(p: Pick<ProjectRow, "site_street" | "site_city" | "site_state" | "site_postal_code">) {
  const cityLine = [p.site_city, [p.site_state, p.site_postal_code].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [p.site_street, cityLine].filter(Boolean).join(", ");
}
