import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type AppRole, canOpenManagePath, isAppRole } from "./roles";

/**
 * Data Access Layer for "who is signed in".
 *
 * Every page and server action that needs a user calls one of these. Results
 * come from `get_my_profile()`, which only returns ACTIVE employees, so a
 * deactivated person is treated as signed out everywhere.
 */
export type Profile = {
  employeeId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  role: AppRole;
  flsaStatus: "nonexempt" | "exempt";
  locale: "en" | "es";
};

export const getProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;

  const { data, error } = await supabase.rpc("get_my_profile").maybeSingle<{
    employee_id: string;
    first_name: string;
    last_name: string;
    display_name: string;
    role: string;
    flsa_status: "nonexempt" | "exempt";
    preferred_locale: "en" | "es";
  }>();
  if (error || !data || !isAppRole(data.role)) return null;

  return {
    employeeId: data.employee_id,
    firstName: data.first_name,
    lastName: data.last_name,
    displayName: data.display_name,
    role: data.role,
    flsaStatus: data.flsa_status,
    locale: data.preferred_locale,
  };
});

/** Require a signed-in, active employee; otherwise go to the sign-in page. */
export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login?reason=no-access");
  return profile;
}

/** Require one of the given roles; otherwise go home. */
export async function requireRole(...roles: AppRole[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/?denied=1");
  return profile;
}

/** Guard for /manage pages, using the same table as the navigation. */
export async function requireManagePath(pathname: string): Promise<Profile> {
  const profile = await requireProfile();
  if (!canOpenManagePath(profile.role, pathname)) redirect("/?denied=1");
  return profile;
}
