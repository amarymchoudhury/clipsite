import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SetupRequiredError } from "@/lib/errors";

/** Per-request client acting as the signed-in user (RLS applies). */
export function supabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "NEXT_PUBLIC_SUPABASE_ANON_KEY"].filter(Boolean) as string[];
    throw new SetupRequiredError("Supabase", missing);
  }
  const store = cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // called from a Server Component; middleware refreshes the session instead
        }
      },
    },
  });
}
