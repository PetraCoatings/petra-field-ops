/**
 * Supabase connection settings, read from environment variables.
 *
 * Public values (URL + publishable/anon key) are safe in the browser: every
 * table is protected by Row Level Security. The secret (service-role) key is
 * read ONLY in `admin.ts`, which is marked `server-only`.
 */
export function supabaseUrl(): string {
  const v = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!v) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set. See docs/SETUP.md.");
  return v;
}

export function supabasePublishableKey(): string {
  const v =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!v) {
    throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is not set. See docs/SETUP.md.");
  }
  return v;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  );
}
