import "server-only";
import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "./env";

/**
 * Privileged Supabase client using the SECRET (service-role) key.
 *
 * It bypasses Row Level Security, so it is used ONLY for operations that
 * Supabase does not expose to ordinary users — currently: sending account
 * invitations. Callers MUST verify the current user is an office admin first.
 * `server-only` makes the build fail if this file is ever imported by
 * browser code.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set. See docs/SETUP.md.");
  return createClient(supabaseUrl(), key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
