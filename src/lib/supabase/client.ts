"use client";
import { createBrowserClient } from "@supabase/ssr";
import { supabasePublishableKey, supabaseUrl } from "./env";

/** Browser Supabase client (user's session; RLS applies). */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabasePublishableKey());
}
