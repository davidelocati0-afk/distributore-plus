import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client.
 * Prefers SERVICE_ROLE if available, falls back to ANON.
 * Cache tables (mise_cache, photo_cache) have permissive RLS policies for anon,
 * and price_reports has insert-only policy for anon. Application-level checks
 * guard the admin GET endpoint on price_reports.
 */
let cached: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars missing (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY)');
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
