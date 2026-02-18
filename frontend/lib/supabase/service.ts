import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for server-side operations that bypass RLS.
 * Only use in Server Actions / Route Handlers — never expose to the browser.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  console.log('[SERVICE CLIENT] URL:', url);
  console.log('[SERVICE CLIENT] Key prefix:', key?.substring(0, 20) + '...');

  return createClient(url, key, { auth: { persistSession: false } });
}
