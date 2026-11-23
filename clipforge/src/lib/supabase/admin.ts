import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import { SetupRequiredError } from "@/lib/errors";

let client: SupabaseClient | null = null;

/** Service-role client. Server and worker only; bypasses RLS, so always scope by user_id. */
export function admin(): SupabaseClient {
  if (!client) {
    const missing: string[] = [];
    if (!env.NEXT_PUBLIC_SUPABASE_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
    if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) throw new SetupRequiredError("Supabase", missing);
    client = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export const BUCKET = env.SUPABASE_STORAGE_BUCKET;
